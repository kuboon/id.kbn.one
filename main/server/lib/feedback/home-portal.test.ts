import { assert, assertEquals, assertRejects } from "@std/assert";

import {
  homePortalReporter,
  threadBodyFor,
  threadTitleFor,
} from "./home-portal.ts";
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

/** What the portal's MCP endpoint answers, from a recorded real response. */
const toolResult = (value: unknown) =>
  Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify(value) }] },
  });

interface Call {
  url: string;
  authorization: string | null;
  tool: string;
  args: Record<string, unknown>;
}

/** A fake endpoint that records each `tools/call` and answers in turn. */
const recorder = (responses: Response[]) => {
  const calls: Call[] = [];
  const fetchImpl = ((input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      tool: body.params.name,
      args: body.params.arguments,
    });
    assertEquals(body.method, "tools/call");
    return Promise.resolve(
      responses.shift() ?? new Response("unexpected call", { status: 500 }),
    );
  }) as typeof fetch;
  return { calls, fetchImpl };
};

Deno.test("home portal: each report becomes its own thread with the report as first post", async () => {
  const { calls, fetchImpl } = recorder([
    toolResult({ id: "thread-9", homeId: "home-1" }),
    toolResult({ id: "msg-1" }),
  ]);
  await homePortalReporter(TARGET, fetchImpl)(feedback());

  assertEquals(calls.map((c) => c.tool), ["create_thread", "post_message"]);
  assert(calls.every((c) => c.url === TARGET.url));
  assert(calls.every((c) => c.authorization === `Bearer ${TOKEN}`));
  assertEquals(calls[0].args, {
    homeId: "home-1",
    title: "[バグ報告] ga-cen.kbn.one: 保存ボタンが反応しない",
  });
  // The post goes into the thread the first call created, not a guess.
  assertEquals(calls[1].args.threadId, "thread-9");
  assertEquals(calls[1].args.body, threadBodyFor(feedback()));
});

Deno.test("home portal: the user's words are quoted, and where they came from is listed", () => {
  const body = threadBodyFor(feedback());
  // Unverified text from an RP's user reads as theirs, line by line.
  assert(body.includes("> 保存ボタンが反応しない\n> 2回目も同じ"));
  assert(body.includes("- RP: https://ga-cen.kbn.one"));
  assert(body.includes("- ページ: https://ga-cen.kbn.one/claim"));
  assert(body.includes("- 送信者: user-1"));
  assert(body.includes("- 受付: 2026-10-22T09:30:00.000Z"));
  assert(body.includes("- ID: fb-1"));

  const bare = threadBodyFor(
    feedback({ origin: undefined, pageUrl: undefined }),
  );
  assert(bare.includes("- RP: (IdP 自身)"));
  assert(!bare.includes("ページ"));
});

Deno.test("home portal: a long first line is shortened in the title", () => {
  const title = threadTitleFor(
    feedback({ kind: "request", message: "あ".repeat(80) + "\n詳細" }),
  );
  assertEquals(title, `[要望] ga-cen.kbn.one: ${"あ".repeat(50)}…`);
});

Deno.test("home portal: every way of failing names the step, never the token", async () => {
  const failures: [string, Response[]][] = [
    ["HTTP 401", [new Response("no", { status: 401 })]],
    ["not JSON", [new Response("<html>", { status: 200 })]],
    [
      "was refused",
      [Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          isError: true,
          content: [{ type: "text", text: "no such home" }],
        },
      })],
    ],
    [
      "bad request",
      [Response.json({
        jsonrpc: "2.0",
        id: 1,
        error: { message: "bad request" },
      })],
    ],
    ["no thread id", [toolResult({ title: "x" })]],
    [
      "post_message failed: HTTP 503",
      [toolResult({ id: "thread-9" }), new Response("", { status: 503 })],
    ],
  ];
  for (const [mentions, responses] of failures) {
    const { fetchImpl } = recorder(responses);
    const error = await assertRejects(() =>
      homePortalReporter(TARGET, fetchImpl)(feedback())
    );
    const message = (error as Error).message;
    assert(message.includes(mentions), `"${message}" lacks "${mentions}"`);
    assert(!message.includes(TOKEN), "the token leaked into an error");
  }
});
