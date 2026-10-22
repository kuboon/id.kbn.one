/**
 * Reports feedback to the owner's home portal over its MCP endpoint.
 *
 * Each report becomes its own thread: the title says what kind and from
 * which RP, the first post carries the full text and where it came from.
 * A thread per report is what lets the owner answer, discuss or close each
 * one where it landed.
 *
 * The endpoint is a stateless MCP server answering JSON, so this speaks the
 * two `tools/call` requests it needs directly rather than pulling in an MCP
 * client. The token only ever travels in the `Authorization` header; no error
 * here repeats it.
 *
 * @module
 */

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

const hostOf = (origin: string | undefined): string => {
  if (!origin) return "IdP";
  try {
    return new URL(origin).host;
  } catch {
    return "IdP";
  }
};

/** First line, shortened: enough to tell reports apart in a thread list. */
const headline = (message: string): string => {
  const first = message.split("\n", 1)[0].trim();
  return first.length > 50 ? first.slice(0, 50) + "…" : first;
};

export const threadTitleFor = (feedback: StoredFeedback): string =>
  `[${KIND_LABEL[feedback.kind]}] ${hostOf(feedback.origin)}: ${
    headline(feedback.message)
  }`;

/**
 * The first post. What the user wrote is quoted, line by line, so it reads as
 * their words and not as the portal's — it is unverified text from an RP's
 * user, and anything reading the thread should take it as that.
 */
export const threadBodyFor = (feedback: StoredFeedback): string => {
  const quoted = feedback.message.split("\n").map((line) => `> ${line}`)
    .join("\n");
  const meta = [
    `- RP: ${feedback.origin ?? "(IdP 自身)"}`,
    ...(feedback.pageUrl ? [`- ページ: ${feedback.pageUrl}`] : []),
    `- 送信者: ${feedback.userId}`,
    `- 受付: ${new Date(feedback.createdAt).toISOString()}`,
    `- ID: ${feedback.id}`,
  ];
  return `**${
    KIND_LABEL[feedback.kind]
  }**（RP のユーザーが送信）\n\n${quoted}\n\n${meta.join("\n")}`;
};

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
    throw new Error(`home portal ${name}: ${body.error.message ?? "error"}`);
  }
  if (!body.result || body.result.isError) {
    const detail = body.result?.content?.[0]?.text ?? "no result";
    throw new Error(`home portal ${name} was refused: ${detail.slice(0, 200)}`);
  }
  return body.result;
};

/** The tools answer with one text part holding JSON. */
const parseText = <T>(result: ToolResult, name: string): T => {
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error(`home portal ${name}: empty result`);
  return JSON.parse(text) as T;
};

/** A `notify` for {@link FeedbackService}: one new thread per report. */
export const homePortalReporter = (
  target: HomePortalTarget,
  fetchImpl: typeof fetch = fetch,
) =>
async (feedback: StoredFeedback): Promise<void> => {
  const thread = parseText<{ id?: string }>(
    await callTool(target, fetchImpl, "create_thread", {
      homeId: target.homeId,
      title: threadTitleFor(feedback),
    }),
    "create_thread",
  );
  if (!thread.id) throw new Error("home portal create_thread: no thread id");
  await callTool(target, fetchImpl, "post_message", {
    threadId: thread.id,
    body: threadBodyFor(feedback),
  });
};
