import { assert, assertEquals } from "@std/assert";
import { createDpopProof, generateDpopKeyPair, verifyDpopProof } from "@scope/dpop";
import type { PasskeySessionData } from "./types.ts";

Deno.test("DPoP integration - create and verify proof", async () => {
  const keyPair = await generateDpopKeyPair();
  const method = "POST";
  const url = "https://example.com/webauthn/register/verify";

  const proof = await createDpopProof({
    keyPair,
    method,
    url,
  });

  assert(proof);
  assertEquals(typeof proof, "string");

  const result = await verifyDpopProof({
    proof,
    method,
    url,
  });

  assert(result.valid);
  assert(result.jwk);
  assertEquals(result.jwk.kty, "EC");
  assertEquals(result.jwk.crv, "P-256");
});

Deno.test("DPoP integration - session data with JWK", async () => {
  const keyPair = await generateDpopKeyPair();
  const method = "POST";
  const url = "https://example.com/webauthn/authenticate/verify";

  const proof = await createDpopProof({
    keyPair,
    method,
    url,
  });

  const verifyResult = await verifyDpopProof({
    proof,
    method,
    url,
  });

  assert(verifyResult.valid);
  assert(verifyResult.jwk);

  const sessionData: PasskeySessionData = {
    userId: "user123",
    dpopJwk: verifyResult.jwk,
  };

  assertEquals(sessionData.userId, "user123");
  assert(sessionData.dpopJwk);
  assertEquals(sessionData.dpopJwk.kty, "EC");
});

Deno.test("DPoP integration - verify JWK matches", async () => {
  const keyPair = await generateDpopKeyPair();
  const method = "GET";
  const url = "https://example.com/session";

  const proof1 = await createDpopProof({
    keyPair,
    method,
    url,
  });

  const result1 = await verifyDpopProof({
    proof1,
    method,
    url,
  });

  assert(result1.valid);
  const sessionJwk = result1.jwk!;

  const proof2 = await createDpopProof({
    keyPair,
    method,
    url: "https://example.com/account",
  });

  const result2 = await verifyDpopProof({
    proof: proof2,
    method,
    url: "https://example.com/account",
  });

  assert(result2.valid);
  const requestJwk = result2.jwk!;

  assertEquals(sessionJwk.kty, requestJwk.kty);
  assertEquals(sessionJwk.crv, requestJwk.crv);
  assertEquals(sessionJwk.x, requestJwk.x);
  assertEquals(sessionJwk.y, requestJwk.y);
});

Deno.test("DPoP integration - different keys should not match", async () => {
  const keyPair1 = await generateDpopKeyPair();
  const keyPair2 = await generateDpopKeyPair();
  const method = "POST";
  const url = "https://example.com/webauthn/authenticate/verify";

  const proof1 = await createDpopProof({
    keyPair: keyPair1,
    method,
    url,
  });

  const proof2 = await createDpopProof({
    keyPair: keyPair2,
    method,
    url,
  });

  const result1 = await verifyDpopProof({
    proof: proof1,
    method,
    url,
  });

  const result2 = await verifyDpopProof({
    proof: proof2,
    method,
    url,
  });

  assert(result1.valid);
  assert(result2.valid);

  const jwk1 = result1.jwk!;
  const jwk2 = result2.jwk!;

  const keysMatch =
    jwk1.kty === jwk2.kty &&
    jwk1.crv === jwk2.crv &&
    jwk1.x === jwk2.x &&
    jwk1.y === jwk2.y;

  assertEquals(keysMatch, false);
});
