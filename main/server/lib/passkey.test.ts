/**
 * The passkey repository and the JTI store, exercised on D1.
 *
 * Both lost Deno KV's multi-key transaction in the move to `KvRepo`, so the
 * behaviour that used to come from a single atomic commit — a duplicate id
 * being refused, a credential never outliving its index, one secret winning a
 * race — has to be verified against the backend that will actually run them.
 * `createSqliteD1` is a real SQL engine, so the compare-and-set is the real one.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import type { PasskeyCredential } from "@kuboon/passkeys/remix";

import { D1_KV_SCHEMA, D1KvRepo } from "@kuboon/kv/d1.ts";
import { createSqliteD1 } from "@kuboon/kv/d1Sqlite.ts";

import { KvPasskeyRepository, type PasskeyStores } from "./passkey.ts";
import { JtiStore } from "../repository/jti-store.ts";

const credential = (
  over: Partial<PasskeyCredential> = {},
): PasskeyCredential => ({
  id: "cred-1",
  userId: "alice",
  nickname: "iPhone",
  publicKey: "pub-b64url",
  counter: 0,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const setup = () => {
  const db = createSqliteD1();
  for (const statement of D1_KV_SCHEMA.split(";")) {
    if (statement.trim()) db.prepare(statement + ";").bind().run();
  }
  const stores: PasskeyStores = {
    credentials: new D1KvRepo<PasskeyCredential>(db, ["credential"]),
    userCredentials: (userId) =>
      new D1KvRepo<PasskeyCredential>(db, ["user_credentials", userId]),
    signSecret: new D1KvRepo<string>(db, []),
  };
  return { db, repo: new KvPasskeyRepository(stores), stores };
};

/** What `/me` lists, straight out of the index. */
const indexedIds = async (
  stores: PasskeyStores,
  userId: string,
): Promise<string[]> => {
  const ids: string[] = [];
  for await (const entry of stores.userCredentials(userId)) {
    ids.push(String(entry.key));
  }
  return ids.sort();
};

Deno.test("passkey on D1: a credential is readable by id and by user", async () => {
  const { db, repo, stores } = setup();
  try {
    await repo.addCredential(credential());
    assertEquals(await repo.getCredentialById("cred-1"), credential());
    assertEquals(await repo.getCredentialsByUserId("alice"), [credential()]);
    assertEquals(await indexedIds(stores, "alice"), ["cred-1"]);
    assertEquals(await repo.getCredentialById("nope"), null);
    assertEquals(await repo.getCredentialsByUserId("bob"), []);
  } finally {
    db.close();
  }
});

Deno.test("passkey on D1: a duplicate id is refused, leaving the first intact", async () => {
  const { db, repo } = setup();
  try {
    await repo.addCredential(credential({ nickname: "first" }));
    await assertRejects(
      () => repo.addCredential(credential({ nickname: "second" })),
      Error,
      "Credential already exists",
    );
    const stored = await repo.getCredentialById("cred-1");
    assertEquals(stored?.nickname, "first");
  } finally {
    db.close();
  }
});

Deno.test("passkey on D1: two concurrent registrations of one id — exactly one wins", async () => {
  const { db, repo } = setup();
  try {
    const results = await Promise.allSettled([
      repo.addCredential(credential({ nickname: "a" })),
      repo.addCredential(credential({ nickname: "b" })),
    ]);
    assertEquals(results.filter((r) => r.status === "fulfilled").length, 1);
    // And the loser left nothing behind: the winner's record is intact.
    const all = await repo.getCredentialsByUserId("alice");
    assertEquals(all.length, 1);
  } finally {
    db.close();
  }
});

Deno.test("passkey on D1: the signature counter is updated in both places", async () => {
  const { db, repo, stores } = setup();
  try {
    await repo.addCredential(credential());
    await repo.updateCredential(credential({ counter: 7, updatedAt: 2 }));

    assertEquals((await repo.getCredentialById("cred-1"))?.counter, 7);
    const indexed = await stores.userCredentials("alice").entry("cred-1").get();
    assertEquals(indexed?.counter, 7);

    await assertRejects(
      () => repo.updateCredential(credential({ id: "ghost" })),
      Error,
      "Credential does not exist",
    );
  } finally {
    db.close();
  }
});

Deno.test("passkey on D1: moving a credential to another user moves its index", async () => {
  const { db, repo, stores } = setup();
  try {
    await repo.addCredential(credential());
    await repo.updateCredential(credential({ userId: "bob" }));

    assertEquals(await indexedIds(stores, "alice"), []);
    assertEquals(await indexedIds(stores, "bob"), ["cred-1"]);
    assertEquals(await repo.getCredentialsByUserId("alice"), []);
    assertEquals((await repo.getCredentialById("cred-1"))?.userId, "bob");
  } finally {
    db.close();
  }
});

Deno.test("passkey on D1: a deleted credential is gone from both places", async () => {
  const { db, repo, stores } = setup();
  try {
    await repo.addCredential(credential());
    await repo.deleteCredential("cred-1");

    // The by-id row is what authenticates, so this is the one that matters.
    assertEquals(await repo.getCredentialById("cred-1"), null);
    assertEquals(await indexedIds(stores, "alice"), []);
    // Deleting what is not there is not an error.
    await repo.deleteCredential("cred-1");
  } finally {
    db.close();
  }
});

Deno.test("passkey on D1: deleting a user takes every credential with it", async () => {
  const { db, repo, stores } = setup();
  try {
    await repo.addCredential(credential({ id: "c1" }));
    await repo.addCredential(credential({ id: "c2" }));
    await repo.addCredential(credential({ id: "c3", userId: "bob" }));

    await repo.deleteCredentialsByUserId("alice");

    assertEquals(await repo.getCredentialById("c1"), null);
    assertEquals(await repo.getCredentialById("c2"), null);
    assertEquals(await indexedIds(stores, "alice"), []);
    // Another user's passkey is untouched.
    assertEquals((await repo.getCredentialById("c3"))?.userId, "bob");
    assertEquals(await indexedIds(stores, "bob"), ["c3"]);
  } finally {
    db.close();
  }
});

Deno.test("passkey on D1: the sign secret is generated once and then reused", async () => {
  const { db, repo } = setup();
  try {
    const first = await repo.getOrCreateSignSecret(() => "secret-one");
    assertEquals(first, "secret-one");
    // A later call must not mint a new one: challenges signed with the old
    // secret would stop verifying and every sign-in would fail.
    assertEquals(
      await repo.getOrCreateSignSecret(() => "secret-two"),
      "secret-one",
    );
  } finally {
    db.close();
  }
});

Deno.test("passkey on D1: concurrent callers agree on one sign secret", async () => {
  const { db, repo } = setup();
  try {
    const secrets = await Promise.all([
      repo.getOrCreateSignSecret(() => "a"),
      repo.getOrCreateSignSecret(() => "b"),
      repo.getOrCreateSignSecret(() => "c"),
    ]);
    assertEquals(new Set(secrets).size, 1, `diverged: ${secrets.join(",")}`);
    // And it is the one that was stored, not a local fallback.
    assertEquals(await repo.getOrCreateSignSecret(() => "d"), secrets[0]);
  } finally {
    db.close();
  }
});

Deno.test("jti store on D1: a jti is accepted once", async () => {
  const db = createSqliteD1();
  try {
    for (const statement of D1_KV_SCHEMA.split(";")) {
      if (statement.trim()) db.prepare(statement + ";").bind().run();
    }
    const store = new JtiStore(
      new D1KvRepo<boolean>(db, ["dpop_jti"], { expireIn: 1000 * 60 * 10 }),
    );
    assert(await store.checkReplay("j1"), "a fresh jti must be accepted");
    assert(!await store.checkReplay("j1"), "a replay must be rejected");
    assert(await store.checkReplay("j2"));

    // Two proofs racing with the same jti: one gets in, the other is a replay.
    const raced = await Promise.all([
      store.checkReplay("j3"),
      store.checkReplay("j3"),
    ]);
    assertEquals(raced.filter(Boolean).length, 1);
  } finally {
    db.close();
  }
});
