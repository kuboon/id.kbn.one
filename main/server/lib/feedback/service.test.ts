import { assert, assertEquals } from "@std/assert";

import { D1Repo } from "@kbn/kv/d1.ts";
import { createSqliteD1 } from "../../../../kv/d1_sqlite_test_util.ts";

import { PushRateLimiter } from "../push/rate-limit.ts";
import {
  FeedbackService,
  notificationFor,
  ownerNotifier,
  type StoredFeedback,
} from "./service.ts";

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

Deno.test("feedback: a report is stored as sent and the owners are told", async () => {
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

Deno.test("feedback: over the limit nothing is stored and nobody is told", async () => {
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

Deno.test("feedback: a failed notification does not fail the report", async () => {
  // The report is already safe; an error here would only make the user
  // send it again.
  const db = createSqliteD1();
  try {
    const repo = new D1Repo<StoredFeedback>(db, ["feedback"]);
    const service = new FeedbackService({
      repo,
      limiter: allow,
      notify: () => Promise.reject(new Error("push service down")),
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

Deno.test("ownerNotifier: only the owners' subscriptions made on the IdP", async () => {
  const IDP = "https://id.kbn.one";
  const sent: string[] = [];
  const notify = ownerNotifier({
    ownerIds: ["owner-1", "owner-2"],
    isIdpSubscription: (origin) => !origin || origin === IDP,
    listSubscriptions: (userId) =>
      Promise.resolve(
        userId === "owner-1"
          ? [
            // Registered on the IdP's own /me: no Origin was recorded.
            { id: "mac" },
            { id: "iphone", origin: IDP },
            // Registered on an RP's page: shown under that RP's name.
            { id: "rp-app", origin: "https://ga-cen.kbn.one" },
          ]
          : [{ id: "dead" }, { id: "alive", origin: IDP }],
      ),
    send: (userId, subscriptionId) => {
      if (subscriptionId === "dead") return Promise.reject(new Error("gone"));
      sent.push(`${userId}/${subscriptionId}`);
      return Promise.resolve();
    },
  });

  await notify(input() as unknown as StoredFeedback);
  // One dead device does not stop the rest.
  assertEquals(sent.sort(), [
    "owner-1/iphone",
    "owner-1/mac",
    "owner-2/alive",
  ]);
});

Deno.test("ownerNotifier: with no owners configured, nothing is sent", async () => {
  let listed = 0;
  await ownerNotifier({
    ownerIds: [],
    isIdpSubscription: () => true,
    listSubscriptions: () => {
      listed++;
      return Promise.resolve([]);
    },
    send: () => Promise.resolve(),
  })(input() as unknown as StoredFeedback);
  assertEquals(listed, 0);
});

Deno.test("notificationFor: names the RP and keeps the excerpt short", () => {
  const long = "x".repeat(300);
  const n = notificationFor({
    ...input({ kind: "request", message: long }),
    id: "1",
    createdAt: 0,
  });
  assertEquals(n.title, "フィードバック: 要望");
  assert(n.body.startsWith("ga-cen.kbn.one — "));
  assert(n.body.endsWith("…"));
  assert(n.body.length < 160);

  const fromIdp = notificationFor({
    ...input({ origin: undefined, message: "short" }),
    id: "2",
    createdAt: 0,
  });
  assertEquals(fromIdp.body, "IdP — short");
});
