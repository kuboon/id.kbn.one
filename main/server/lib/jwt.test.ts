/**
 * `signJwt` produces a JWS that round-trips through `jose.jwtVerify` against
 * the JWKS exposed at `/.well-known/jwks.json`.
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  type JSONWebKeySet,
  jwtVerify,
} from "jose";

import router from "../router.ts";
import { signJwt } from "./jwt.ts";
import { getSigningKey } from "./signing-key.ts";

const fetchJwks = async (): Promise<JSONWebKeySet> => {
  const response = await router.fetch(
    new Request("http://localhost/.well-known/jwks.json", { method: "GET" }),
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("content-type"),
    "application/jwk-set+json",
  );
  return await response.json() as JSONWebKeySet;
};

const baseClaims = (overrides: Record<string, unknown> = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://idp.example.com",
    sub: "user-1",
    nbf: now,
    exp: now + 60,
    jti: crypto.randomUUID(),
    cnf: { jkt: "rp-thumbprint" },
    ...overrides,
  };
};

Deno.test("signJwt: header includes kid matching JWKS", async () => {
  const token = await signJwt(baseClaims());
  const header = decodeProtectedHeader(token);
  const { kid } = await getSigningKey();
  assertEquals(header.alg, "ES256");
  assertEquals(header.typ, "JWT");
  assertEquals(header.kid, kid);
});

Deno.test("jwtVerify: round-trip via local JWKS", async () => {
  const jwks = await fetchJwks();
  const JWKS = createLocalJWKSet(jwks);
  const token = await signJwt(baseClaims());
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: "https://idp.example.com",
  });
  assertEquals(payload.sub, "user-1");
  assertEquals((payload.cnf as { jkt: string }).jkt, "rp-thumbprint");
});

Deno.test("jwtVerify: rejects wrong issuer", async () => {
  const JWKS = createLocalJWKSet(await fetchJwks());
  const token = await signJwt(baseClaims());
  await assertRejects(
    () => jwtVerify(token, JWKS, { issuer: "https://attacker.example" }),
    Error,
    "iss",
  );
});

Deno.test("jwtVerify: rejects expired token", async () => {
  const JWKS = createLocalJWKSet(await fetchJwks());
  const past = Math.floor(Date.now() / 1000) - 120;
  const token = await signJwt(baseClaims({ nbf: past - 60, exp: past }));
  await assertRejects(
    () => jwtVerify(token, JWKS, { issuer: "https://idp.example.com" }),
    Error,
    "exp",
  );
});

Deno.test("jwtVerify: rejects tampered signature", async () => {
  const JWKS = createLocalJWKSet(await fetchJwks());
  const token = await signJwt(baseClaims());
  const [h, p, s] = token.split(".");
  // Flip one byte of the signature segment.
  const tampered = `${h}.${p}.${s.slice(0, -2)}${
    s.slice(-2) === "AA" ? "AB" : "AA"
  }`;
  await assertRejects(
    () => jwtVerify(tampered, JWKS, { issuer: "https://idp.example.com" }),
    Error,
  );
});

Deno.test("JWKS: shape is JWKS-compliant", async () => {
  const jwks = await fetchJwks();
  assertEquals(jwks.keys.length, 1);
  const [k] = jwks.keys;
  assertEquals(k.kty, "EC");
  assertEquals(k.crv, "P-256");
  assertEquals(k.alg, "ES256");
  assertEquals(k.use, "sig");
  // Private bits must not leak.
  assertEquals((k as Record<string, unknown>).d, undefined);
});
