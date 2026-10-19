import { assert, assertEquals, assertThrows } from "@std/assert";

import { D1_KV_SCHEMA, D1Repo } from "@kbn/kv/d1.ts";
import { createSqliteD1 } from "../../kv/d1_sqlite_test_util.ts";

import {
  decodeKeyParts,
  decodeValue,
  encodeKeyParts,
  encodeValue,
  type ExportedEntry,
  isEphemeral,
} from "./codec.ts";
import {
  assertJsonStorable,
  insertStatement,
  splitSchema,
  sqlString,
} from "./kv-import-d1.ts";
import { batchStatements, createD1HttpClient } from "./d1-http.ts";

Deno.test("codec: key parts round-trip with their types", () => {
  const key = ["credential", 1, true, 9n];
  assertEquals(decodeKeyParts(encodeKeyParts(key)), key);
  // A number part must not collapse into its string form.
  assert(
    JSON.stringify(encodeKeyParts([1])) !==
      JSON.stringify(encodeKeyParts(["1"])),
  );
});

Deno.test("codec: values round-trip, including the types JSON lacks", () => {
  const value = {
    s: "x",
    n: 1,
    b: false,
    nil: null,
    arr: [1, "2", { deep: true }],
    bytes: new Uint8Array([0, 255, 7]),
    big: 42n,
    when: new Date("2026-01-02T03:04:05.000Z"),
  };
  const back = decodeValue(
    JSON.parse(JSON.stringify(encodeValue(value))),
  ) as typeof value;
  assertEquals(back.s, "x");
  assertEquals(back.arr, value.arr);
  assertEquals([...back.bytes], [0, 255, 7]);
  assertEquals(back.big, 42n);
  assertEquals(back.when.toISOString(), value.when.toISOString());
});

Deno.test("codec: an optional field left undefined is ordinary data", () => {
  // Production push subscriptions carry `metadata.lastError?: string`, and an
  // export that throws on it exports nothing at all.
  const value = { metadata: { lastError: undefined, failures: 0 } };
  const back = decodeValue(
    JSON.parse(JSON.stringify(encodeValue(value))),
  ) as typeof value;
  assertEquals(back.metadata.lastError, undefined);
  assertEquals(back.metadata.failures, 0);
  // JSON drops the property on the way into D1, which is what the optional
  // type means, so the import accepts it.
  assertJsonStorable(back);
});

Deno.test("codec: an unsupported value fails loudly instead of corrupting", () => {
  assertThrows(() => encodeValue(new Map([["a", 1]])), TypeError);
  assertThrows(() => encodeValue(new Set([1])), TypeError);
  assertThrows(() => encodeValue(NaN), TypeError);
});

Deno.test("codec: ephemeral prefixes are the short-lived ones only", () => {
  const k = (...parts: string[]) => encodeKeyParts(parts);
  assert(isEphemeral(k("dpop-session", "abc")));
  assert(isEphemeral(k("dpop_jti", "abc")));
  assert(isEphemeral(k("oauth", "consumed", "jti")));
  assert(isEphemeral(k("push", "ratelimit", "x")));
  // Durable data must never be classed ephemeral.
  assert(!isEphemeral(k("credential", "c1")));
  assert(!isEphemeral(k("user_credentials", "alice", "c1")));
  assert(!isEphemeral(k("secret", "signing_key")));
  assert(!isEphemeral(k("passkey_sign_secret")));
  assert(!isEphemeral(k("push", "subscription", "s1")));
  assert(!isEphemeral(k("push", "user", "subscriptions", "alice", "s1")));
});

Deno.test("import: a value D1 cannot hold is refused, naming the key", () => {
  const key = encodeKeyParts(["credential", "cred-1"]);
  // D1Repo stores JSON, so these would read back as the wrong type. Writing the
  // encoded form verbatim would hand the app `{$kvmig:"u8",…}` instead.
  for (const value of [new Uint8Array([1, 2]), 42n, new Date()]) {
    const error = assertThrows(
      () => insertStatement(key, encodeValue(value)),
      TypeError,
    );
    assert(
      error.message.includes("credential/cred-1"),
      `error does not name the key: ${error.message}`,
    );
  }
  // An array hole would silently become null.
  assertThrows(
    () => insertStatement(key, encodeValue([1, undefined, 3])),
    TypeError,
  );
});

Deno.test("sqlString: quotes are escaped so a value cannot break out", () => {
  assertEquals(sqlString("it's"), "'it''s'");
  assertEquals(sqlString("'; DROP TABLE kv; --"), "'''; DROP TABLE kv; --'");
});

Deno.test(
  "migration end-to-end: Deno KV -> export -> SQL -> D1 reads the same values",
  async () => {
    const kv = await Deno.openKv(":memory:");
    const db = createSqliteD1();
    try {
      // Representative production shapes, including the two that would cost
      // users their accounts if they did not survive.
      const jwkPair = {
        publicKey: { kty: "EC", crv: "P-256", x: "x", y: "y" },
        privateKey: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" },
      };
      const credential = {
        id: "cred-1",
        userId: "alice",
        nickname: "iPhone",
        publicKey: "pub-b64url",
        counter: 3,
        backedUp: true,
      };
      await kv.set(["secret", "signing_key"], jwkPair);
      await kv.set(["passkey_sign_secret"], "sign-secret-b64");
      await kv.set(["credential", "cred-1"], credential);
      await kv.set(["user_credentials", "alice", "cred-1"], { id: "cred-1" });
      await kv.set(["push", "subscription", "s1"], { endpoint: "https://e" });
      // The shape that crashed the first production export: an optional field
      // present but undefined. It must reach D1 as JSON, not as a codec tag.
      await kv.set(["push", "subscription", "s2"], {
        endpoint: "https://e2",
        metadata: { lastError: undefined, failures: 0 },
      });
      await kv.set(["push", "user", "subscriptions", "alice", "s1"], {
        id: "s1",
      });
      // Ephemeral: must NOT be carried over.
      await kv.set(["dpop-session", "thumb"], { userId: "alice" });
      await kv.set(["oauth", "consumed", "jti-1"], true);
      await kv.set(["push", "ratelimit", "s1:w1"], 1);

      // --- export (the same calls the CLI makes) ---
      const rows: ExportedEntry[] = [];
      for await (const entry of kv.list({ prefix: [] })) {
        rows.push({
          key: encodeKeyParts(entry.key),
          value: encodeValue(entry.value),
        });
      }
      // Survives a real serialisation hop, as the JSONL file does.
      const reread = rows.map((r) =>
        JSON.parse(JSON.stringify(r)) as ExportedEntry
      );

      // --- import ---
      let imported = 0;
      for (const row of reread) {
        if (isEphemeral(row.key)) continue;
        const sql = insertStatement(row.key, row.value);
        await db.prepare(sql).bind().run();
        imported++;
      }
      assertEquals(imported, 7);

      // --- read back through the app's own repo ---
      const secrets = new D1Repo<typeof jwkPair>(db, ["secret"]);
      assertEquals(await secrets.entry("signing_key").get(), jwkPair);

      const creds = new D1Repo<typeof credential>(db, ["credential"]);
      assertEquals(await creds.entry("cred-1").get(), credential);

      // A single-part key with no sub-key still resolves.
      const signSecret = new D1Repo<string>(db, []);
      assertEquals(
        await signSecret.entry("passkey_sign_secret").get(),
        "sign-secret-b64",
      );

      // Index listings work, which is how credentials are found per user.
      const index = new D1Repo<{ id: string }>(db, [
        "user_credentials",
        "alice",
      ]);
      const indexKeys: unknown[] = [];
      for await (const e of index) indexKeys.push(e.key);
      assertEquals(indexKeys, ["cred-1"]);

      const subs = new D1Repo<{
        endpoint: string;
        metadata?: { lastError?: string; failures: number };
      }>(db, ["push", "subscription"]);
      assertEquals(await subs.entry("s1").get(), { endpoint: "https://e" });
      assertEquals(await subs.entry("s2").get(), {
        endpoint: "https://e2",
        metadata: { failures: 0 },
      });

      // Ephemeral state did not come across.
      const sessions = new D1Repo<unknown>(db, ["dpop-session"]);
      assertEquals(await sessions.entry("thumb").get(), null);
      const consumed = new D1Repo<boolean>(db, ["oauth", "consumed"]);
      assertEquals(await consumed.entry("jti-1").get(), null);
      // ...so a fresh token with a reused jti is still accepted once.
      assertEquals((await consumed.entry("jti-1").update(() => true)).ok, true);
    } finally {
      db.close();
      kv.close();
    }
  },
);

Deno.test("batchStatements: respects both the count and the byte budget", () => {
  const s = ["a;", "b;", "c;", "d;"];
  assertEquals(batchStatements(s, 2, 1000).map((b) => b.length), [2, 2]);
  // One oversized statement still goes out on its own rather than being lost.
  const big = "x".repeat(100);
  assertEquals(batchStatements([big, big], 10, 120).map((b) => b.length), [
    1,
    1,
  ]);
  assertEquals(batchStatements([], 10, 100), []);
  // Every statement survives batching.
  assertEquals(batchStatements(s, 3, 1000).flat(), s);
});

Deno.test("splitSchema: yields runnable statements", () => {
  const stmts = splitSchema(D1_KV_SCHEMA);
  assert(stmts.length >= 2);
  assert(stmts.every((s) => s.endsWith(";")));
  assert(stmts.some((s) => s.includes("CREATE TABLE")));
});

Deno.test(
  "d1 client: a failure never leaks the SQL (it carries the signing key)",
  async () => {
    const SECRET_SQL = "INSERT INTO kv VALUES ('secret-signing-key-material');";
    const failing: typeof fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ success: false, errors: [{ message: "boom" }] }),
          { status: 400 },
        ),
      );
    const client = createD1HttpClient({
      accountId: "acct",
      databaseId: "db",
      token: "tok-should-not-appear",
      fetchImpl: failing,
    });

    const error = await client.run([SECRET_SQL]).then(
      () => null,
      (e: unknown) => e as Error,
    );
    assert(error, "expected a rejection");
    assert(
      !error.message.includes("secret-signing-key-material"),
      `SQL leaked into the error: ${error.message}`,
    );
    assert(
      !error.message.includes("tok-should-not-appear"),
      "token leaked into the error",
    );
    // It still says enough to locate the failure.
    assert(error.message.includes("boom"));
    assert(error.message.includes("statements 1-1"));
  },
);
