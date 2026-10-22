import { assert, assertEquals, assertRejects } from "@std/assert";

import { MemoryKvRepo } from "@kbn/kv/memory.ts";

import { homePortalReporter, postBodyFor } from "./home-portal.ts";
import type { StoredFeedback } from "./service.ts";

const TOKEN = "hpa_test_token_must_never_appear";
const TARGET = {
  url: "https://portal.example/mcp/agent_x",
  token: TOKEN,
  homeId: "home-1",
};

const feedback = (over: Partial<StoredFeedback> = {}): StoredFeedback => ({
  id: "fb-1",
  kind: "bug",
  message: "保存ボタンが反応しない\n2回目も同じ",
  userId: "user-1",
  origin: "https://ga-cen.kbn.one",
  pageUrl: "https://ga-cen.kbn.one/claim",
  createdAt: Date.UTC(2026, 9, 22, 9, 30),
  ...over,
});

/** Answers as the real portal does: one text part holding JSON. */
const ok = (value: unknown) =>
  Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify(value) }] },
  });

/** The real portal's answer to a post into a thread that does not exist. */
const threadNotFound = () =>
  Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: "thread not found" }],
      isError: true,
    },
  });

/** The real portal's answer to two posts sent at once (one of them). */
const rateLimited = () =>
  Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: "rate limited" }],
      isError: true,
    },
  });

const noSleep = () => Promise.resolve();

interface Call {
  authorization: string | null;
  tool: string;
  args: Record<string, unknown>;
}

/** A fake endpoint that records each `tools/call` and answers in turn. */
const portal = (responses: Response[]) => {
  const calls: Call[] = [];
  const fetchImpl = ((_input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assertEquals(body.method, "tools/call");
    calls.push({
      authorization: new Headers(init?.headers).get("authorization"),
      tool: body.params.name,
      args: body.params.arguments,
    });
    return Promise.resolve(
      responses.shift() ?? new Response("unexpected call", { status: 500 }),
    );
  }) as typeof fetch;
  return { calls, fetchImpl, more: (r: Response[]) => responses.push(...r) };
};

Deno.test("home portal: an RP's first report makes its thread, later ones join it", async () => {
  const threads = new MemoryKvRepo<string>();
  const p = portal([ok({ id: "t-gacen" }), ok({ id: "m1" })]);
  const report = homePortalReporter(TARGET, threads, {
    fetchImpl: p.fetchImpl,
    sleep: noSleep,
  });

  await report(feedback());
  assertEquals(p.calls.map((c) => c.tool), ["create_thread", "post_message"]);
  assertEquals(p.calls[0].args, {
    homeId: "home-1",
    title: "フィードバック: ga-cen.kbn.one",
  });
  assertEquals(p.calls[1].args.threadId, "t-gacen");
  assertEquals(await threads.entry("ga-cen.kbn.one").get(), "t-gacen");
  assert(p.calls.every((c) => c.authorization === `Bearer ${TOKEN}`));

  // The same RP again: straight into its thread, no new one.
  p.more([ok({ id: "m2" })]);
  await report(feedback({ id: "fb-2", message: "別件" }));
  assertEquals(p.calls.slice(2).map((c) => [c.tool, c.args.threadId]), [
    ["post_message", "t-gacen"],
  ]);
});

Deno.test("home portal: each RP host gets its own thread", async () => {
  const threads = new MemoryKvRepo<string>();
  const p = portal([
    ok({ id: "t-gacen" }),
    ok({}),
    ok({ id: "t-gtd" }),
    ok({}),
    ok({ id: "t-idp" }),
    ok({}),
  ]);
  const report = homePortalReporter(TARGET, threads, {
    fetchImpl: p.fetchImpl,
    sleep: noSleep,
  });

  await report(feedback());
  // A sibling under the same registrable domain is still a different RP.
  await report(feedback({ origin: "https://gtd.kbn.one" }));
  await report(feedback({ origin: undefined }));

  assertEquals(
    p.calls.filter((c) => c.tool === "create_thread").map((c) => c.args.title),
    [
      "フィードバック: ga-cen.kbn.one",
      "フィードバック: gtd.kbn.one",
      "フィードバック: IdP",
    ],
  );
});

Deno.test("home portal: a deleted thread is replaced, and remembered anew", async () => {
  const threads = new MemoryKvRepo<string>();
  await threads.entry("ga-cen.kbn.one").update(() => "t-deleted");
  const p = portal([threadNotFound(), ok({ id: "t-new" }), ok({})]);

  await homePortalReporter(TARGET, threads, {
    fetchImpl: p.fetchImpl,
    sleep: noSleep,
  })(feedback());

  assertEquals(p.calls.map((c) => [c.tool, c.args.threadId ?? c.args.title]), [
    ["post_message", "t-deleted"],
    ["create_thread", "フィードバック: ga-cen.kbn.one"],
    ["post_message", "t-new"],
  ]);
  assertEquals(await threads.entry("ga-cen.kbn.one").get(), "t-new");
});

Deno.test("home portal: a portal that is down makes no duplicate thread", async () => {
  // Only a refusal means the thread is gone. A transport failure on a known
  // thread must not be taken for one, or every outage would add a thread.
  const threads = new MemoryKvRepo<string>();
  await threads.entry("ga-cen.kbn.one").update(() => "t-gacen");
  const p = portal([new Response("", { status: 503 })]);

  await assertRejects(
    () =>
      homePortalReporter(TARGET, threads, {
        fetchImpl: p.fetchImpl,
        sleep: noSleep,
      })(feedback()),
    Error,
    "post_message failed: HTTP 503",
  );
  assertEquals(p.calls.map((c) => c.tool), ["post_message"]);
  assertEquals(await threads.entry("ga-cen.kbn.one").get(), "t-gacen");
});

Deno.test("home portal: being rate-limited waits and retries, and makes no new thread", async () => {
  // Measured on the real portal: of two posts sent together one is refused
  // "rate limited", and a retry half a second later goes through. Taking that
  // refusal for a deleted thread would add a thread on every collision.
  const threads = new MemoryKvRepo<string>();
  await threads.entry("ga-cen.kbn.one").update(() => "t-gacen");
  const p = portal([rateLimited(), ok({})]);
  const waits: number[] = [];

  await homePortalReporter(TARGET, threads, {
    fetchImpl: p.fetchImpl,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  })(feedback());

  assertEquals(p.calls.map((c) => [c.tool, c.args.threadId]), [
    ["post_message", "t-gacen"],
    ["post_message", "t-gacen"],
  ]);
  assertEquals(waits, [1000]);
  assertEquals(await threads.entry("ga-cen.kbn.one").get(), "t-gacen");
});

Deno.test("home portal: rate limits on creating the thread are retried too", async () => {
  const threads = new MemoryKvRepo<string>();
  const p = portal([
    rateLimited(),
    ok({ id: "t-gacen" }),
    rateLimited(),
    ok({}),
  ]);
  await homePortalReporter(TARGET, threads, {
    fetchImpl: p.fetchImpl,
    sleep: noSleep,
  })(
    feedback(),
  );
  assertEquals(p.calls.map((c) => c.tool), [
    "create_thread",
    "create_thread",
    "post_message",
    "post_message",
  ]);
  assertEquals(await threads.entry("ga-cen.kbn.one").get(), "t-gacen");
});

Deno.test("home portal: a rate limit that will not lift gives up, keeping the thread", async () => {
  const threads = new MemoryKvRepo<string>();
  await threads.entry("ga-cen.kbn.one").update(() => "t-gacen");
  const p = portal([rateLimited(), rateLimited(), rateLimited()]);

  await assertRejects(
    () =>
      homePortalReporter(TARGET, threads, {
        fetchImpl: p.fetchImpl,
        sleep: noSleep,
      })(
        feedback(),
      ),
    Error,
    "rate limited",
  );
  // Three tries, then stop: no thread is made for it.
  assertEquals(p.calls.map((c) => c.tool), [
    "post_message",
    "post_message",
    "post_message",
  ]);
  assertEquals(await threads.entry("ga-cen.kbn.one").get(), "t-gacen");
});

Deno.test("home portal: a post leads with the kind and gist, then quotes the user", () => {
  const body = postBodyFor(feedback());
  assert(
    body.startsWith(
      "**[バグ報告] 保存ボタンが反応しない**（RP のユーザーが送信）",
    ),
  );
  // Unverified text from an RP's user reads as theirs, line by line.
  assert(body.includes("> 保存ボタンが反応しない\n> 2回目も同じ"));
  assert(body.includes("- RP: https://ga-cen.kbn.one"));
  assert(body.includes("- ページ: https://ga-cen.kbn.one/claim"));
  assert(body.includes("- 送信者: user-1"));
  assert(body.includes("- 受付: 2026-10-22T09:30:00.000Z"));
  assert(body.includes("- ID: fb-1"));

  const long = postBodyFor(
    feedback({ kind: "request", message: "あ".repeat(80) }),
  );
  assert(long.startsWith(`**[要望] ${"あ".repeat(50)}…**`));

  const bare = postBodyFor(feedback({ origin: undefined, pageUrl: undefined }));
  assert(bare.includes("- RP: (IdP 自身)"));
  assert(!bare.includes("ページ"));
});

Deno.test("home portal: every way of failing names the step, never the token", async () => {
  const failures: [string, Response[]][] = [
    ["HTTP 401", [new Response("no", { status: 401 })]],
    ["not JSON", [new Response("<html>", { status: 200 })]],
    [
      "bad request",
      [Response.json({
        jsonrpc: "2.0",
        id: 1,
        error: { message: "bad request" },
      })],
    ],
    ["no thread id", [ok({ title: "x" })]],
    ["post_message failed: HTTP 503", [
      ok({ id: "t" }),
      new Response("", { status: 503 }),
    ]],
  ];
  for (const [mentions, responses] of failures) {
    const p = portal(responses);
    const error = await assertRejects(() =>
      homePortalReporter(TARGET, new MemoryKvRepo<string>(), {
        fetchImpl: p.fetchImpl,
        sleep: noSleep,
      })(
        feedback(),
      )
    );
    const message = (error as Error).message;
    assert(message.includes(mentions), `"${message}" lacks "${mentions}"`);
    assert(!message.includes(TOKEN), "the token leaked into an error");
  }
});
