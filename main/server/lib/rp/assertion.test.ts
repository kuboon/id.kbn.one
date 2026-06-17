import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";

import {
  CLIENT_ASSERTION_TYP,
  ClientAssertionError,
  type ReplayCheck,
  verifyClientAssertion,
} from "./assertion.ts";
import { buildRpClientRegistry } from "./clients.ts";

const AUD = "https://idp.example.com";
const CLIENT_ID = "rp.example.com";

const setup = async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  const registry = buildRpClientRegistry([
    { clientId: CLIENT_ID, keys: [{ ...publicJwk, alg: "ES256", kid }] },
  ]);

  const sign = (
    overrides: Record<string, unknown> = {},
    header: Record<string, unknown> = {},
  ) => {
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: CLIENT_ID,
      sub: CLIENT_ID,
      aud: AUD,
      jti: crypto.randomUUID(),
      ...overrides,
    };
    return new SignJWT(claims)
      .setProtectedHeader({
        alg: "ES256",
        typ: CLIENT_ASSERTION_TYP,
        kid,
        ...header,
      })
      .setIssuedAt(now)
      .setExpirationTime(overrides.exp as number ?? now + 60)
      .sign(privateKey);
  };

  // Default replay check that accepts every jti once.
  const seen = new Set<string>();
  const replay: ReplayCheck = (jti) =>
    Promise.resolve(seen.has(jti) ? false : (seen.add(jti), true));

  const verify = (assertion: string, replayOverride?: ReplayCheck) =>
    verifyClientAssertion(assertion, {
      audience: AUD,
      registry,
      replay: replayOverride ?? replay,
    });

  return { sign, verify, privateKey, kid };
};

Deno.test("verifyClientAssertion: valid assertion returns clientId", async () => {
  const { sign, verify } = await setup();
  const { clientId } = await verify(await sign());
  assertEquals(clientId, CLIENT_ID);
});

Deno.test("verifyClientAssertion: rejects unknown client", async () => {
  const { sign, verify } = await setup();
  const assertion = await sign({ iss: "attacker", sub: "attacker" });
  await assertRejects(
    () => verify(assertion),
    ClientAssertionError,
    "Unknown client",
  );
});

Deno.test("verifyClientAssertion: rejects wrong audience", async () => {
  const { sign, verify } = await setup();
  const assertion = await sign({ aud: "https://elsewhere.example" });
  await assertRejects(() => verify(assertion), ClientAssertionError);
});

Deno.test("verifyClientAssertion: rejects expired assertion", async () => {
  const { sign, verify } = await setup();
  const past = Math.floor(Date.now() / 1000) - 120;
  const assertion = await sign({ exp: past });
  await assertRejects(() => verify(assertion), ClientAssertionError);
});

Deno.test("verifyClientAssertion: rejects wrong typ header", async () => {
  const { sign, verify } = await setup();
  const assertion = await sign({}, { typ: "JWT" });
  await assertRejects(() => verify(assertion), ClientAssertionError);
});

Deno.test("verifyClientAssertion: rejects sub != iss", async () => {
  const { sign, verify } = await setup();
  const assertion = await sign({ sub: "someone-else" });
  await assertRejects(() => verify(assertion), ClientAssertionError);
});

Deno.test("verifyClientAssertion: rejects replayed jti", async () => {
  const { sign, verify } = await setup();
  const assertion = await sign();
  await verify(assertion);
  await assertRejects(
    () => verify(assertion),
    ClientAssertionError,
    "replayed",
  );
});

Deno.test("verifyClientAssertion: rejects assertion signed by another key", async () => {
  const { verify } = await setup();
  // Sign with a key that is NOT registered for CLIENT_ID.
  const other = await generateKeyPair("ES256", { extractable: true });
  const now = Math.floor(Date.now() / 1000);
  const forged = await new SignJWT({
    iss: CLIENT_ID,
    sub: CLIENT_ID,
    aud: AUD,
    jti: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: "ES256", typ: CLIENT_ASSERTION_TYP })
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(other.privateKey);
  await assertRejects(() => verify(forged), ClientAssertionError);
});

Deno.test("buildRpClientRegistry: rejects entry without keys", () => {
  assertThrows(
    () => buildRpClientRegistry([{ clientId: "x" }]),
    TypeError,
    "no public keys",
  );
});
