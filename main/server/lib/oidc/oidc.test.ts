/**
 * OIDC Authorization Code flow integration tests.
 *
 * Drives `/authorize/code` (DPoP-bound), `/token`, and `/userinfo` against
 * the in-process router. PKCE verifier+challenge are generated per test.
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { encodeBase64Url } from "@std/encoding/base64url";
import { createLocalJWKSet, jwtVerify } from "jose";

Deno.env.set("IDP_ORIGIN", "https://idp.example.com");
Deno.env.set("AUTHORIZE_WHITELIST", "rp.example.com");
Deno.env.set("RP_ID", "localhost");

const { default: router } = await import("../../router.ts");
const { issueAuthorizationCode } = await import("./code-store.ts");

const ISS = "https://idp.example.com";
const CLIENT_ID = "https://app.rp.example.com";
const REDIRECT_URI = "https://app.rp.example.com/cb";

const newPkce = async () => {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = encodeBase64Url(verifierBytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: encodeBase64Url(new Uint8Array(digest)) };
};

const fetchJwks = async () => {
  const response = await router.fetch(
    new Request(`${ISS}/.well-known/jwks.json`, { method: "GET" }),
  );
  assertEquals(response.status, 200);
  return await response.json();
};

Deno.test("discovery: advertises code flow endpoints", async () => {
  const r = await router.fetch(
    new Request(`${ISS}/.well-known/openid-configuration`, { method: "GET" }),
  );
  assertEquals(r.status, 200);
  const doc = await r.json();
  assertEquals(doc.issuer, ISS);
  assertEquals(doc.token_endpoint, `${ISS}/token`);
  assertEquals(doc.userinfo_endpoint, `${ISS}/userinfo`);
  assertEquals(doc.response_types_supported, ["code"]);
  assertEquals(doc.grant_types_supported, ["authorization_code"]);
  assertEquals(doc.code_challenge_methods_supported, ["S256"]);
  assertEquals(doc.token_endpoint_auth_methods_supported, ["none"]);
  assertEquals(doc.id_token_signing_alg_values_supported, ["ES256"]);
  assertEquals(doc.scopes_supported, ["openid", "profile", "email"]);
  assert(doc.claims_supported.includes("email"));
  assert(doc.claims_supported.includes("preferred_username"));
});

Deno.test("/authorize: rejects non-whitelisted redirect_uri", async () => {
  const url = new URL(`${ISS}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", "https://evil.example.com");
  url.searchParams.set("redirect_uri", "https://evil.example.com/cb");
  url.searchParams.set("scope", "openid");
  url.searchParams.set("state", "abc");
  url.searchParams.set("code_challenge", "x".repeat(43));
  url.searchParams.set("code_challenge_method", "S256");
  const r = await router.fetch(new Request(url, { method: "GET" }));
  assertEquals(r.status, 400);
  const body = await r.json();
  assertEquals(body.error, "unauthorized_client");
});

Deno.test("/authorize: rejects missing PKCE", async () => {
  const url = new URL(`${ISS}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("state", "abc");
  const r = await router.fetch(new Request(url, { method: "GET" }));
  assertEquals(r.status, 400);
  const body = await r.json();
  assertEquals(body.error, "invalid_request");
});

Deno.test("/authorize: renders OIDC mode for valid params", async () => {
  const { challenge } = await newPkce();
  const url = new URL(`${ISS}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("state", "state-1");
  url.searchParams.set("nonce", "nonce-1");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  const r = await router.fetch(new Request(url, { method: "GET" }));
  assertEquals(r.status, 200);
  const text = await r.text();
  assert(text.includes("kbn.one ID"));
});

Deno.test("/token: requires form-encoded body", async () => {
  const r = await router.fetch(
    new Request(`${ISS}/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  assertEquals(r.status, 400);
  const body = await r.json();
  assertEquals(body.error, "invalid_request");
});

Deno.test("/token: rejects unknown code", async () => {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: "nonexistent",
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: "v".repeat(43),
  });
  const r = await router.fetch(
    new Request(`${ISS}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
  );
  assertEquals(r.status, 400);
  const body = await r.json();
  assertEquals(body.error, "invalid_grant");
});

Deno.test("/token: end-to-end issues id_token + access_token", async () => {
  const { verifier, challenge } = await newPkce();
  const code = await issueAuthorizationCode({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email",
    nonce: "nonce-x",
    user_id: "user-42",
    auth_time: Math.floor(Date.now() / 1000),
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  const r = await router.fetch(
    new Request(`${ISS}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
  );
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("cache-control"), "no-store");
  const body = await r.json();
  assertEquals(body.token_type, "Bearer");
  assertEquals(body.scope, "openid profile email");
  assert(typeof body.id_token === "string");
  assert(typeof body.access_token === "string");

  const jwks = createLocalJWKSet(await fetchJwks());
  const { payload: idPayload } = await jwtVerify(body.id_token, jwks, {
    issuer: ISS,
    audience: CLIENT_ID,
  });
  assertEquals(idPayload.sub, "user-42");
  assertEquals(idPayload.nonce, "nonce-x");
  assert(typeof idPayload.auth_time === "number");
  assertEquals(idPayload.email, "user-42@idp.example.com");
  assertEquals(idPayload.preferred_username, "user-42");
  assertEquals(idPayload.name, "user-42");

  const { payload: atPayload } = await jwtVerify(body.access_token, jwks, {
    issuer: ISS,
    audience: `${ISS}/userinfo`,
  });
  assertEquals(atPayload.sub, "user-42");
  assertEquals(atPayload.scope, "openid profile email");

  // Code is single-use: second exchange must fail.
  const r2 = await router.fetch(
    new Request(`${ISS}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
  );
  assertEquals(r2.status, 400);
  assertEquals((await r2.json()).error, "invalid_grant");

  // /userinfo with the issued bearer
  const ui = await router.fetch(
    new Request(`${ISS}/userinfo`, {
      method: "GET",
      headers: { authorization: `Bearer ${body.access_token}` },
    }),
  );
  assertEquals(ui.status, 200);
  assertEquals(await ui.json(), {
    sub: "user-42",
    email: "user-42@idp.example.com",
    email_verified: false,
    preferred_username: "user-42",
    name: "user-42",
  });
});

Deno.test("/userinfo: openid-only scope omits email/profile claims", async () => {
  const { verifier, challenge } = await newPkce();
  const code = await issueAuthorizationCode({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid",
    user_id: "user-min",
    auth_time: Math.floor(Date.now() / 1000),
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  const r = await router.fetch(
    new Request(`${ISS}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
  );
  const body = await r.json();
  const ui = await router.fetch(
    new Request(`${ISS}/userinfo`, {
      method: "GET",
      headers: { authorization: `Bearer ${body.access_token}` },
    }),
  );
  assertEquals(await ui.json(), { sub: "user-min" });
});

Deno.test("/authorize: rejects unsupported scope", async () => {
  const { challenge } = await newPkce();
  const url = new URL(`${ISS}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", "openid wallet");
  url.searchParams.set("state", "s");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  const r = await router.fetch(new Request(url, { method: "GET" }));
  assertEquals(r.status, 400);
  assertEquals((await r.json()).error, "invalid_scope");
});

Deno.test("/token: PKCE mismatch fails", async () => {
  const { challenge } = await newPkce();
  const code = await issueAuthorizationCode({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid",
    user_id: "user-1",
    auth_time: Math.floor(Date.now() / 1000),
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: "wrong-verifier-".padEnd(43, "x"),
  });
  const r = await router.fetch(
    new Request(`${ISS}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
  );
  assertEquals(r.status, 400);
  assertEquals((await r.json()).error, "invalid_grant");
});

Deno.test("/userinfo: rejects missing bearer", async () => {
  const r = await router.fetch(
    new Request(`${ISS}/userinfo`, { method: "GET" }),
  );
  assertEquals(r.status, 401);
  assertMatch(r.headers.get("www-authenticate") ?? "", /^Bearer/);
});

Deno.test("/userinfo: rejects token with wrong audience", async () => {
  const { signJwt } = await import("../jwt.ts");
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({
    iss: ISS,
    sub: "user-1",
    aud: ISS, // wrong: should be `${ISS}/userinfo`
    exp: now + 60,
    iat: now,
    jti: crypto.randomUUID(),
  });
  const r = await router.fetch(
    new Request(`${ISS}/userinfo`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  assertEquals(r.status, 401);
});
