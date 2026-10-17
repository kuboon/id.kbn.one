import { assert, assertEquals } from "@std/assert";

import { D1Repo, decodeKey, encodeKey, sweepExpired } from "./d1.ts";
import { createSqliteD1 } from "./d1_sqlite_test_util.ts";

const withDb = async (
  fn: (db: ReturnType<typeof createSqliteD1>) => Promise<void>,
) => {
  const db = createSqliteD1();
  try {
    await fn(db);
  } finally {
    db.close();
  }
};

Deno.test("D1Repo: set then get round-trips the value", async () => {
  await withDb(async (db) => {
    const repo = new D1Repo<{ n: number }>(db, ["things"]);
    assertEquals(await repo.entry("a").get(), null);
    const res = await repo.entry("a").update(() => ({ n: 1 }));
    assertEquals(res.ok, true);
    assertEquals(await repo.entry("a").get(), { n: 1 });
  });
});

Deno.test("D1Repo: concurrent create — exactly one wins (single-use)", async () => {
  await withDb(async (db) => {
    const repo = new D1Repo<boolean>(db, ["oauth", "consumed"]);
    // Both read "absent" before either writes, as two requests replaying the
    // same authorization code would.
    const a = repo.entry("jti-1");
    const b = repo.entry("jti-1");
    const [r1, r2] = await Promise.all([
      a.update((cur) => (cur ? cur : true)),
      b.update((cur) => (cur ? cur : true)),
    ]);
    assertEquals([r1.ok, r2.ok].filter(Boolean).length, 1);
  });
});

Deno.test("D1Repo: update() re-reads, so a concurrent write is not clobbered", async () => {
  await withDb(async (db) => {
    const repo = new D1Repo<number>(db, ["counter"]);
    await repo.entry("c").update(() => 1);

    // Capture a read, let someone else write, then try to commit on the old
    // version — the losing half of a read-modify-write race.
    const stale = repo.entry("c");
    const staleRead = await stale.get();
    assertEquals(staleRead, 1);
    await repo.entry("c").update(() => 2);

    const res = await stale.update((cur) => (cur ?? 0) + 10);
    // It re-reads inside update(), so it sees 2 and succeeds with 12 — the
    // CAS protects the committed row, not a value read earlier.
    assertEquals(res.ok, true);
    assertEquals(await repo.entry("c").get(), 12);
  });
});

Deno.test("D1Repo: delete removes the row", async () => {
  await withDb(async (db) => {
    const repo = new D1Repo<string>(db, ["things"]);
    await repo.entry("a").update(() => "x");
    assertEquals((await repo.entry("a").update(() => null)).ok, true);
    assertEquals(await repo.entry("a").get(), null);
    // Deleting an absent key is a no-op success.
    assertEquals((await repo.entry("a").update(() => null)).ok, true);
  });
});

Deno.test("D1Repo: an expired entry reads as absent and is not listed", async () => {
  await withDb(async (db) => {
    const repo = new D1Repo<string>(db, ["ttl"]);
    await repo.entry("gone").update(() => "x", { expireIn: -1 });
    await repo.entry("stays").update(() => "y", { expireIn: 60_000 });

    assertEquals(await repo.entry("gone").get(), null);
    assertEquals(await repo.entry("stays").get(), "y");

    const keys: unknown[] = [];
    for await (const e of repo) keys.push(e.key);
    assertEquals(keys, ["stays"]);

    assertEquals(await sweepExpired(db), 1);
  });
});

Deno.test("D1Repo: listing covers the prefix only, and not the prefix key itself", async () => {
  await withDb(async (db) => {
    const push = new D1Repo<string>(db, ["push", "subscription"]);
    const other = new D1Repo<string>(db, ["push", "ratelimit"]);
    await push.entry("s1").update(() => "a");
    await push.entry("s2").update(() => "b");
    await other.entry("r1").update(() => "c");
    // A value stored *at* the prefix must not show up in its own listing.
    await new D1Repo<string>(db, ["push"]).entry("subscription").update(() =>
      "self"
    );

    const keys: unknown[] = [];
    for await (const e of push) keys.push(e.key);
    assertEquals(keys, ["s1", "s2"]);
  });
});

Deno.test("D1Repo: a deeper key is listed under its ancestor prefix", async () => {
  await withDb(async (db) => {
    // ["user_credentials", userId, credentialId] listed by [.., userId]
    const index = new D1Repo<string>(db, ["user_credentials", "alice"]);
    await index.entry("cred-1").update(() => "x");
    const deep = new D1Repo<string>(db, ["user_credentials"]);
    const keys: unknown[] = [];
    for await (const e of deep) keys.push(e.key);
    assertEquals(keys, ["alice"]);
  });
});

Deno.test("encodeKey/decodeKey: round-trip preserves part types", () => {
  const key = ["s", 42, true, 7n];
  assertEquals(decodeKey(encodeKey(key)), key);
  // A number and the same digits as a string must not collide.
  assert(encodeKey([1]) !== encodeKey(["1"]));
});

Deno.test("encodeKey/decodeKey: separators and backslashes survive", () => {
  for (
    const part of [
      "a\u0000b",
      "a\u0001b",
      "a\\0b",
      "a\\1b",
      "back\\slash",
      "\\",
      "\\\\0",
      "plain",
    ]
  ) {
    assertEquals(decodeKey(encodeKey([part])), [part]);
  }
});

Deno.test("encodeKey: an escaped separator cannot forge a key boundary", async () => {
  await withDb(async (db) => {
    // "a\u0001b" (the raw separator) as one part must not collide with the
    // two parts ["a","b"].
    const one = new D1Repo<string>(db, ["ns"]);
    await one.entry("a\u0001b").update(() => "single");
    const two = new D1Repo<string>(db, ["ns", "a"]);
    await two.entry("b").update(() => "nested");

    assertEquals(await one.entry("a\u0001b").get(), "single");
    assertEquals(await two.entry("b").get(), "nested");
  });
});
