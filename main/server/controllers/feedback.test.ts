import { assert, assertEquals } from "@std/assert";

import router from "../router.ts";
import type { CorsContext } from "../middlewares.ts";
import { User } from "../middleware/user.ts";
import { feedbackRepo } from "../repositories.ts";
import { submitFeedbackAction } from "./feedback.ts";

/** What the `cors:` layer hands the action once DPoP and the user check pass. */
const contextFor = (
  userId: string,
  body: unknown,
  origin = "https://ga-cen.kbn.one",
): CorsContext =>
  ({
    request: new Request("http://localhost/feedback", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    get: (key: unknown) => {
      if (key !== User) throw new Error("unexpected context key");
      return { id: userId, logout: () => Promise.resolve() };
    },
  }) as unknown as CorsContext;

// A fresh sender per test: submissions are rate-limited per user, and the
// counters live in the same local store across runs.
const sender = () => `test-${crypto.randomUUID()}`;

Deno.test("POST /feedback is behind the signed-in user layer", async () => {
  const res = await router.fetch(
    new Request("http://localhost/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "bug", message: "x" }),
    }),
  );
  // Not 404 (it is routed) and not 2xx (no DPoP session, no user).
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

Deno.test("feedback: the sender and the RP come from the request, not the body", async () => {
  const userId = sender();
  const res = await submitFeedbackAction(contextFor(userId, {
    kind: "bug",
    message: "  the button does nothing  ",
    pageUrl: "https://ga-cen.kbn.one/claim",
    // A page script could put anything here; none of it may be believed.
    userId: "someone-else",
    origin: "https://evil.example",
  }));
  assertEquals(res.status, 201);
  const { id } = await res.json() as { id: string };

  const stored = await feedbackRepo.entry(id).get();
  assert(stored);
  assertEquals(stored.userId, userId);
  assertEquals(stored.origin, "https://ga-cen.kbn.one");
  assertEquals(stored.message, "the button does nothing");
  assertEquals(stored.pageUrl, "https://ga-cen.kbn.one/claim");
  await feedbackRepo.entry(id).update(() => null);
});

Deno.test("feedback: malformed reports are refused", async () => {
  const userId = sender();
  const cases: [unknown, string][] = [
    ["not json", "Invalid JSON body"],
    [{ kind: "rant", message: "x" }, "kind"],
    [{ kind: "bug", message: "" }, "message"],
    [{ kind: "bug", message: "   " }, "must not be blank"],
    [{ kind: "bug", message: "x".repeat(4001) }, "message"],
    [{ kind: "bug", message: "x", pageUrl: "javascript:alert(1)" }, "http(s)"],
  ];
  for (const [body, mentions] of cases) {
    const res = await submitFeedbackAction(contextFor(userId, body));
    assertEquals(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    const { message } = await res.json() as { message: string };
    assert(message.includes(mentions), `"${message}" lacks "${mentions}"`);
  }
});

Deno.test("feedback: the sixth report in an hour is refused with 429", async () => {
  const userId = sender();
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const res = await submitFeedbackAction(
      contextFor(userId, { kind: "request", message: `idea ${i}` }),
    );
    assertEquals(res.status, 201);
    ids.push((await res.json() as { id: string }).id);
  }
  const res = await submitFeedbackAction(
    contextFor(userId, { kind: "request", message: "one more" }),
  );
  assertEquals(res.status, 429);
  await res.body?.cancel();
  for (const id of ids) await feedbackRepo.entry(id).update(() => null);
});
