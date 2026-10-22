import { assert, assertEquals } from "@std/assert";

import { D1Repo } from "@kbn/kv/d1.ts";
import { createSqliteD1 } from "../../../../kv/d1_sqlite_test_util.ts";

import { PushRateLimiter } from "../push/rate-limit.ts";
import { FeedbackService, type StoredFeedback } from "./service.ts";

const allow = { tryAcquire: () => Promise.resolve(true) };

const input = (
  over: Partial<Parameters<FeedbackService["submit"]>[0]> = {},
) => ({
  kind: "bug" as const,
  message: "the button does nothing",
  userId: "alice",
  origin: "https://ga-cen.kbn.one",
  pageUrl: "https://ga-cen.kbn.one/claim",
  ...over,
});

const listAll = async (repo: D1Repo<StoredFeedback>) => {
  const out: StoredFeedback[] = [];
  for await (const e of repo) {
    const v = await e.get();
    if (v) out.push(v);
  }
  return out;
};

Deno.test("feedback: a report is stored as sent and then reported", async () => {
  const db = createSqliteD1();
  try {
    const repo = new D1Repo<StoredFeedback>(db, ["feedback"]);
    const told: StoredFeedback[] = [];
    const service = new FeedbackService({
      repo,
      limiter: allow,
      notify: (f) => {
        told.push(f);
        return Promise.resolve();
      },
      now: () => 1000,
    });

    const result = await service.submit(input());
    assert(result.ok);
    const stored = await repo.entry(result.feedback.id).get();
    assertEquals(stored, {
      id: result.feedback.id,
      kind: "bug",
      message: "the button does nothing",
      userId: "alice",
      origin: "https://ga-cen.kbn.one",
      pageUrl: "https://ga-cen.kbn.one/claim",
      createdAt: 1000,
    });
    assertEquals(told, [stored]);
  } finally {
    db.close();
  }
});

Deno.test("feedback: reports list oldest first", async () => {
  // The owner reads them straight out of D1, so key order is the order they
  // see. Monotonic ULIDs keep that chronological.
  const db = createSqliteD1();
  try {
    const repo = new D1Repo<StoredFeedback>(db, ["feedback"]);
    const service = new FeedbackService({
      repo,
      limiter: allow,
      notify: () => Promise.resolve(),
    });
    for (const m of ["first", "second", "third"]) {
      await service.submit(input({ message: m }));
    }
    assertEquals((await listAll(repo)).map((f) => f.message), [
      "first",
      "second",
      "third",
    ]);
  } finally {
    db.close();
  }
});

Deno.test("feedback: over the limit nothing is stored or reported", async () => {
  const db = createSqliteD1();
  try {
    const repo = new D1Repo<StoredFeedback>(db, ["feedback"]);
    let told = 0;
    const service = new FeedbackService({
      repo,
      // The real limiter at the controller's settings, over a real engine.
      limiter: new PushRateLimiter(
        new D1Repo<number>(db, ["feedback_ratelimit"]),
        5,
        60 * 60 * 1000,
        () => 0,
      ),
      notify: () => {
        told++;
        return Promise.resolve();
      },
    });

    for (let i = 0; i < 5; i++) assert((await service.submit(input())).ok);
    assertEquals(await service.submit(input()), {
      ok: false,
      reason: "rate_limited",
    });
    assertEquals((await listAll(repo)).length, 5);
    assertEquals(told, 5);
    // The limit is per sender: someone else is unaffected.
    assert((await service.submit(input({ userId: "bob" }))).ok);
  } finally {
    db.close();
  }
});

Deno.test("feedback: a failed report onward does not fail the submission", async () => {
  // The report is already safe; an error here would only make the user
  // send it again.
  const db = createSqliteD1();
  try {
    const repo = new D1Repo<StoredFeedback>(db, ["feedback"]);
    const service = new FeedbackService({
      repo,
      limiter: allow,
      notify: () => Promise.reject(new Error("portal down")),
    });
    const original = console.error;
    console.error = () => {};
    try {
      const result = await service.submit(input());
      assert(result.ok);
      assert(await repo.entry(result.feedback.id).get());
    } finally {
      console.error = original;
    }
  } finally {
    db.close();
  }
});
