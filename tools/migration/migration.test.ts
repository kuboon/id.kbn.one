import { assert, assertEquals, assertThrows } from "@std/assert";

import { D1Repo } from "@kbn/kv/d1.ts";
import { createSqliteD1 } from "../../kv/d1_sqlite_test_util.ts";

import {
  decodeKeyParts,
  decodeValue,
  encodeKeyParts,
  encodeValue,
  type ExportedEntry,
  isEphemeral,
} from "./codec.ts";
import { insertStatement, sqlString } from "./kv-import-d1.ts";

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
      assertEquals(imported, 6);

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

      const subs = new D1Repo<{ endpoint: string }>(db, [
        "push",
        "subscription",
      ]);
      assertEquals(await subs.entry("s1").get(), { endpoint: "https://e" });

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
