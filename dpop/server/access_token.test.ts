import { assertEquals } from "@std/assert";
import { verifyDpopProofFromRequest } from "./mod.ts";
import { base64UrlEncode, computeAth, computeThumbprint } from "../common.ts";

const textEncoder = new TextEncoder();

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
}

async function createProof(
  keyPair: CryptoKeyPair,
  payloadOverrides: Record<string, unknown> = {},
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
  };
  const payload = {
    htm: "GET",
    htu: "https://db.kbn.one/data",
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    ...payloadOverrides,
  };
  const enc = (o: unknown) =>
    base64UrlEncode(textEncoder.encode(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    textEncoder.encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

const ACCESS_TOKEN = "opaque-or-jwt-access-token-string";

const buildRequest = (proof: string) =>
  new Request("https://db.kbn.one/data", {
    headers: { DPoP: proof },
  });

Deno.test("accessToken binding - valid", async () => {
  const keyPair = await generateKeyPair();
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const jkt = await computeThumbprint(publicJwk);
  const ath = await computeAth(ACCESS_TOKEN);
  const proof = await createProof(keyPair, { ath });

  const result = await verifyDpopProofFromRequest(buildRequest(proof), {
    accessToken: {
      token: ACCESS_TOKEN,
      claims: { sub: "user-1", cnf: { jkt } },
    },
  });
  assertEquals(result.valid, true);
});

Deno.test("accessToken binding - jkt mismatch", async () => {
  const keyPair = await generateKeyPair();
  const ath = await computeAth(ACCESS_TOKEN);
  const proof = await createProof(keyPair, { ath });

  const result = await verifyDpopProofFromRequest(buildRequest(proof), {
    accessToken: {
      token: ACCESS_TOKEN,
      claims: { cnf: { jkt: "different-thumbprint" } },
    },
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "jkt-mismatch");
});

Deno.test("accessToken binding - ath mismatch (wrong ath)", async () => {
  const keyPair = await generateKeyPair();
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const jkt = await computeThumbprint(publicJwk);
  const proof = await createProof(keyPair, {
    ath: await computeAth("some-other-token"),
  });

  const result = await verifyDpopProofFromRequest(buildRequest(proof), {
    accessToken: { token: ACCESS_TOKEN, claims: { cnf: { jkt } } },
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "ath-mismatch");
});

Deno.test("accessToken binding - ath mismatch (missing ath)", async () => {
  const keyPair = await generateKeyPair();
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const jkt = await computeThumbprint(publicJwk);
  const proof = await createProof(keyPair); // no ath

  const result = await verifyDpopProofFromRequest(buildRequest(proof), {
    accessToken: { token: ACCESS_TOKEN, claims: { cnf: { jkt } } },
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "ath-mismatch");
});

Deno.test("accessToken binding - cnf.jkt missing on claims", async () => {
  const keyPair = await generateKeyPair();
  const ath = await computeAth(ACCESS_TOKEN);
  const proof = await createProof(keyPair, { ath });

  const result = await verifyDpopProofFromRequest(buildRequest(proof), {
    accessToken: { token: ACCESS_TOKEN, claims: {} },
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "jkt-mismatch");
});
