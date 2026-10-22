/**
 * Reports feedback to the owner's home portal over its MCP endpoint.
 *
 * One thread per RP host: everything from `ga-cen.kbn.one` lands in that
 * RP's thread, so the owner sees each RP's reports together and can answer
 * them in one place. The host is the unit rather than the registrable domain,
 * which would fold every `*.kbn.one` RP into a single thread.
 *
 * Which thread belongs to which host is remembered in storage, not found by
 * title: the owner can rename a thread without a new one appearing. If the
 * remembered thread has been deleted, the portal says "thread not found" and
 * a fresh thread is made in its place. No other failure makes a new thread.
 *
 * The endpoint is a stateless MCP server answering JSON, so this speaks the
 * `tools/call` requests it needs directly rather than pulling in an MCP
 * client. The token only ever travels in the `Authorization` header; no error
 * here repeats it.
 *
 * @module
 */

import type { KvRepo } from "@kbn/kv/types.ts";

import type { FeedbackKind, StoredFeedback } from "./service.ts";

export interface HomePortalTarget {
  /** The agent's MCP endpoint. */
  url: string;
  /** Bearer token for that agent. A secret. */
  token: string;
  /** The home the threads are created in. */
  homeId: string;
}

const KIND_LABEL: Record<FeedbackKind, string> = {
  bug: "バグ報告",
  request: "要望",
  other: "その他",
};

/** The RP host a report came from; `IdP` when it came from the IdP itself. */
export const hostOf = (origin: string | undefined): string => {
  if (!origin) return "IdP";
  try {
    return new URL(origin).host;
  } catch {
    return "IdP";
  }
};

export const threadTitleFor = (host: string): string =>
  `フィードバック: ${host}`;

/** First line, shortened: enough to tell reports apart within a thread. */
const headline = (message: string): string => {
  const first = message.split("\n", 1)[0].trim();
  return first.length > 50 ? first.slice(0, 50) + "…" : first;
};

/**
 * One report as a post. What the user wrote is quoted, line by line, so it
 * reads as their words and not as the portal's — it is unverified text from
 * an RP's user, and anything reading the thread should take it as that.
 */
export const postBodyFor = (feedback: StoredFeedback): string => {
  const quoted = feedback.message.split("\n").map((line) => `> ${line}`)
    .join("\n");
  const meta = [
    `- RP: ${feedback.origin ?? "(IdP 自身)"}`,
    ...(feedback.pageUrl ? [`- ページ: ${feedback.pageUrl}`] : []),
    `- 送信者: ${feedback.userId}`,
    `- 受付: ${new Date(feedback.createdAt).toISOString()}`,
    `- ID: ${feedback.id}`,
  ];
  return `**[${KIND_LABEL[feedback.kind]}] ${
    headline(feedback.message)
  }**（RP のユーザーが送信）\n\n${quoted}\n\n${meta.join("\n")}`;
};

/**
 * The portal answered and said no. Why matters, and the portal only says so
 * in words: a thread that no longer exists justifies making a new one, being
 * rate-limited justifies waiting, and nothing else justifies either.
 * Transport failures are plain errors, kept apart from all three — a portal
 * that is merely down must not cause a new thread.
 */
export class PortalRefusedError extends Error {
  readonly reason: "not_found" | "rate_limited" | "other";
  constructor(message: string, detail: string) {
    super(message);
    this.reason = /not found/i.test(detail)
      ? "not_found"
      : /rate.?limit/i.test(detail)
      ? "rate_limited"
      : "other";
  }
}

interface ToolResult {
  content?: { type?: string; text?: string }[];
  isError?: boolean;
}

const callTool = async (
  target: HomePortalTarget,
  fetchImpl: typeof fetch,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> => {
  const response = await fetchImpl(target.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${target.token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`home portal ${name} failed: HTTP ${response.status}`);
  }
  const body = await response.json().catch(() => null) as {
    result?: ToolResult;
    error?: { message?: string };
  } | null;
  if (!body) throw new Error(`home portal ${name}: response was not JSON`);
  if (body.error) {
    const detail = body.error.message ?? "error";
    throw new PortalRefusedError(`home portal ${name}: ${detail}`, detail);
  }
  if (!body.result || body.result.isError) {
    const detail = body.result?.content?.[0]?.text ?? "no result";
    throw new PortalRefusedError(
      `home portal ${name} was refused: ${detail.slice(0, 200)}`,
      detail,
    );
  }
  return body.result;
};

/** The tools answer with one text part holding JSON. */
const parseText = <T>(result: ToolResult, name: string): T => {
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error(`home portal ${name}: empty result`);
  return JSON.parse(text) as T;
};

export interface HomePortalReporterOptions {
  fetchImpl?: typeof fetch;
  /** Waits between attempts. Replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The portal lets an agent write about once per half second: of two posts
 * sent together, one comes back "rate limited", and a retry half a second
 * later goes through. Reports rarely collide, so a short wait beats the
 * machinery a queue would need; the cost is a second or two on the rare
 * report that does.
 */
const RATE_LIMIT_ATTEMPTS = 3;
const RATE_LIMIT_WAIT_MS = 1000;

/**
 * A `notify` for {@link FeedbackService}: post the report into its RP's
 * thread, making the thread on that RP's first report.
 *
 * @param threads host → thread id, kept across requests.
 */
export const homePortalReporter = (
  target: HomePortalTarget,
  threads: KvRepo<string>,
  {
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: HomePortalReporterOptions = {},
) => {
  const call = async (name: string, args: Record<string, unknown>) => {
    for (let attempt = 1;; attempt++) {
      try {
        return await callTool(target, fetchImpl, name, args);
      } catch (error) {
        const limited = error instanceof PortalRefusedError &&
          error.reason === "rate_limited";
        if (!limited || attempt >= RATE_LIMIT_ATTEMPTS) throw error;
        await sleep(RATE_LIMIT_WAIT_MS);
      }
    }
  };

  const post = (threadId: string, body: string) =>
    call("post_message", { threadId, body });

  const createThread = async (host: string): Promise<string> => {
    const thread = parseText<{ id?: string }>(
      await call("create_thread", {
        homeId: target.homeId,
        title: threadTitleFor(host),
      }),
      "create_thread",
    );
    if (!thread.id) throw new Error("home portal create_thread: no thread id");
    return thread.id;
  };

  return async (feedback: StoredFeedback): Promise<void> => {
    const host = hostOf(feedback.origin);
    const entry = threads.entry(host);
    const body = postBodyFor(feedback);

    const known = await entry.get();
    if (known) {
      try {
        await post(known, body);
        return;
      } catch (error) {
        const gone = error instanceof PortalRefusedError &&
          error.reason === "not_found";
        if (!gone) throw error;
        // The thread was deleted. Forget it — unless another request already
        // replaced it, in which case its replacement is the one to use.
        await entry.update((current) => current === known ? null : current);
      }
    }

    const created = await createThread(host);
    // Two first reports from one RP can both get here; the first stored
    // thread wins and both post into it. The loser's thread stays empty.
    await entry.update((current) => current ?? created);
    await post((await entry.get()) ?? created, body);
  };
};
