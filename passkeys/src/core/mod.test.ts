import { assertEquals, assertRejects } from "@std/assert";

import { createPasskeysCore, UserIdTakenError } from "./mod.ts";
import { InMemoryPasskeyRepository } from "./in-memory-passkey-store.ts";

const storage = new InMemoryPasskeyRepository();
await storage.addCredential({
  id: "cred-rmagic",
  userId: "rmagic",
  nickname: "",
  publicKey: "",
  counter: 0,
  deviceType: "singleDevice",
  backedUp: false,
  createdAt: 0,
  updatedAt: 0,
});
const core = createPasskeysCore({
  rpID: "localhost",
  rpName: "test",
  storage,
  getUserId: () => undefined,
  updateSession: () => undefined,
});
const requestUrl = new URL("http://localhost/");

Deno.test("registrationOptionsForUser: an existing user id is only for its owner", async () => {
  await assertRejects(
    () => core.registrationOptionsForUser({ userName: "rmagic", requestUrl }),
    UserIdTakenError,
  );
  await assertRejects(
    () =>
      core.registrationOptionsForUser({
        userName: "rmagic",
        requestUrl,
        signedInAs: "someone-else",
      }),
    UserIdTakenError,
  );
  const own = await core.registrationOptionsForUser({
    userName: "rmagic",
    requestUrl,
    signedInAs: "rmagic",
  });
  assertEquals(own.optionsResult.excludeCredentials?.length, 1);
});

Deno.test("registrationOptionsForUser: a new user id needs no sign-in", async () => {
  const fresh = await core.registrationOptionsForUser({
    userName: crypto.randomUUID(),
    requestUrl,
    displayName: "たろう",
  });
  assertEquals(fresh.optionsResult.user.name, "たろう");
});
