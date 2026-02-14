import { assertEquals } from "@std/assert";
import { verifyDpopProof, verifyDpopProofFromRequest } from "./mod.ts";
import { base64UrlEncode } from "../common.ts";
import { decodeBase64Url } from "@std/encoding/base64url";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
}

async function createTestProof(
  keyPair: CryptoKeyPair,
  payloadOverrides: Record<string, unknown> = {},
  headerOverrides: Record<string, unknown> = {},
) {
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const header = {
    alg: "ES256",
    typ: "dpop+jwt",
    jwk: {
      kty: publicJwk.kty,
      crv: publicJwk.crv,
      x: publicJwk.x,
      y: publicJwk.y,
    },
    ...headerOverrides,
  };

  const payload = {
    htm: "GET",
    htu: "https://example.com/api",
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    ...payloadOverrides,
  };

  const encodedHeader = base64UrlEncode(textEncoder.encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    textEncoder.encode(signingInput),
  );
  const encodedSignature = base64UrlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

Deno.test("verifyDpopProof - valid proof", async () => {
  const keyPair = await generateKeyPair();
  const proof = await createTestProof(keyPair);
  const result = await verifyDpopProof({
    proof,
    method: "GET",
    url: "https://example.com/api",
  });
  assertEquals(result.valid, true);
});

Deno.test("verifyDpopProof - invalid format", async () => {
  const result = await verifyDpopProof({
    proof: "invalid.format",
    method: "GET",
    url: "https://example.com/api",
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid-format");
});

Deno.test("verifyDpopProof - invalid json", async () => {
  const result = await verifyDpopProof({
    proof: "notjson.notjson.signature",
    method: "GET",
    url: "https://example.com/api",
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid-json");
});

Deno.test("verifyDpopProof - invalid type", async () => {
  const keyPair = await generateKeyPair();
  const proof = await createTestProof(keyPair, {}, { typ: "invalid" });
  const result = await verifyDpopProof({
    proof,
    method: "GET",
    url: "https://example.com/api",
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid-type");
});

Deno.test("verifyDpopProof - unsupported algorithm", async () => {
  const keyPair = await generateKeyPair();
  const proof = await createTestProof(keyPair, {}, { alg: "HS256" });
  const result = await verifyDpopProof({
    proof,
    method: "GET",
    url: "https://example.com/api",
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "unsupported-algorithm");
});

Deno.test("verifyDpopProof - invalid jwk", async () => {
  const keyPair = await generateKeyPair();
  const proof = await createTestProof(keyPair, {}, { jwk: { kty: "RSA" } });
  const result = await verifyDpopProof({
    proof,
    method: "GET",
    url: "https://example.com/api",
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid-jwk");
});

Deno.test("verifyDpopProof - method mismatch", async () => {
  const keyPair = await generateKeyPair();
  const proof = await createTestProof(keyPair, { htm: "POST" });
  const result = await verifyDpopProof({
    proof,
    method: "GET",
    url: "https://example.com/api",
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "method-mismatch");
});

Deno.test("verifyDpopProof - url mismatch", async () => {
  const keyPair = await generateKeyPair();
  const proof = await createTestProof(keyPair, { htu: "https://other.com" });
  const result = await verifyDpopProof({
    proof,
    method: "GET",
    url: "https://example.com/api",
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "url-mismatch");
});

Deno.test("verifyDpopProof - invalid url", async () => {
  const keyPair = await generateKeyPair();
  const proof = await createTestProof(keyPair);
  const result = await verifyDpopProof({
    proof,
    method: "GET",
    url: "not-a-url",
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid-url");
});

Deno.test("verifyDpopProof - invalid jti", async () => {
  const keyPair = await generateKeyPair();
  const proof = await createTestProof(keyPair, { jti: "" });
  const result = await verifyDpopProof({
    proof,
    method: "GET",
    url: "https://example.com/api",
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid-jti");
});

Deno.test("verifyDpopProof - invalid iat", async () => {
  const keyPair = await generateKeyPair();
  const proof = await createTestProof(keyPair, { iat: "not-a-number" });
  const result = await verifyDpopProof({
    proof,
    method: "GET",
    url: "https://example.com/api",
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid-iat");
});

Deno.test("verifyDpopProof - future iat", async () => {
  const keyPair = await generateKeyPair();
  const now = Math.floor(Date.now() / 1000);
  const proof = await createTestProof(keyPair, { iat: now + 1000 });
  const result = await verifyDpopProof({
    proof,
    method: "GET",
    url: "https://example.com/api",
  }, { now });
  assertEquals(result.valid, false);
  assertEquals(result.error, "future-iat");
});

Deno.test("verifyDpopProof - expired", async () => {
  const keyPair = await generateKeyPair();
  const now = Math.floor(Date.now() / 1000);
  const proof = await createTestProof(keyPair, { iat: now - 1000 });
  const result = await verifyDpopProof({
    proof,
    method: "GET",
    url: "https://example.com/api",
  }, { now, maxAgeSeconds: 300 });
  assertEquals(result.valid, false);
  assertEquals(result.error, "expired");
});

Deno.test("verifyDpopProof - replay detected", async () => {
  const keyPair = await generateKeyPair();
  const proof = await createTestProof(keyPair);
  const result = await verifyDpopProof({
    proof,
    method: "GET",
    url: "https://example.com/api",
  }, { checkReplay: () => false });
  assertEquals(result.valid, false);
  assertEquals(result.error, "replay-detected");
});

Deno.test("verifyDpopProof - invalid signature", async () => {
  const keyPair = await generateKeyPair();
  const proof = await createTestProof(keyPair);
  const parts = proof.split(".");
  // Tamper with payload
  const payloadBytes = decodeBase64Url(parts[1]);
  const payload = JSON.parse(textDecoder.decode(payloadBytes));
  payload.htm = "POST"; // Change something in the payload
  const tamperedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  const tamperedProof = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

  const result = await verifyDpopProof({
    proof: tamperedProof,
    method: "GET",
    url: "https://example.com/api",
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "invalid-signature");
});

Deno.test("verifyDpopProofFromRequest - valid request", async () => {
  const keyPair = await generateKeyPair();
  const proof = await createTestProof(keyPair);
  const req = new Request("https://example.com/api", {
    headers: {
      "DPoP": proof,
    },
    method: "GET",
  });
  const result = await verifyDpopProofFromRequest(req);
  assertEquals(result.valid, true);
});

Deno.test("verifyDpopProofFromRequest - missing header", async () => {
  const req = new Request("https://example.com/api", {
    method: "GET",
  });
  const result = await verifyDpopProofFromRequest(req);
  assertEquals(result.valid, false);
  assertEquals(result.error, "missing-dpop-header");
});
