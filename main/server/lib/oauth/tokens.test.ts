import { assert, assertEquals } from "@std/assert";
import { decodeJwt, decodeProtectedHeader } from "jose";

import { s256Challenge } from "./pkce.ts";
import {
  exchangeAuthCode,
  issueAuthCode,
  OAuthError,
  refreshTokens,
  type TokenSet,
} from "./tokens.ts";

const VERIFIER = "abcdefghijklmnopqrstuvwxyz0123456789-._~ABCD"; // 43 chars
const CLIENT = "https://client.example.com/oauth/metadata.json";
const REDIRECT = "https://client.example.com/cb";
const RESOURCE = "https://mcp.example.com";

const mintCode = async () =>
  await issueAuthCode({
    sub: "user-1",
    clientId: CLIENT,
    redirectUri: REDIRECT,
    codeChallenge: await s256Challenge(VERIFIER),
    resource: RESOURCE,
    scope: "mcp",
  });

const expectOAuthError = async (fn: () => Promise<unknown>, error: string) => {
  try {
    await fn();
    throw new Error("expected OAuthError");
  } catch (e) {
    assert(e instanceof OAuthError, `not an OAuthError: ${e}`);
    assertEquals(e.error, error);
  }
};

Deno.test("exchangeAuthCode: happy path issues aud-bound access + refresh", async () => {
  const set = await exchangeAuthCode({
    code: await mintCode(),
    clientId: CLIENT,
    redirectUri: REDIRECT,
    codeVerifier: VERIFIER,
  });
  assertEquals(set.token_type, "Bearer");
  assert(set.access_token && set.refresh_token);

  const access = decodeJwt(set.access_token);
  assertEquals(access.aud, RESOURCE); // RFC 8707 binding
  assertEquals(access.sub, "user-1");
  assertEquals(access.client_id, CLIENT);
  assertEquals(decodeProtectedHeader(set.access_token).typ, "at+jwt");
});

Deno.test("exchangeAuthCode: wrong PKCE verifier is rejected", async () => {
  const code = await mintCode();
  await expectOAuthError(
    () =>
      exchangeAuthCode({
        code,
        clientId: CLIENT,
        redirectUri: REDIRECT,
        codeVerifier: VERIFIER.slice(0, -1) + "Z",
      }),
    "invalid_grant",
  );
});

Deno.test("exchangeAuthCode: redirect_uri mismatch is rejected", async () => {
  const code = await mintCode();
  await expectOAuthError(
    () =>
      exchangeAuthCode({
        code,
        clientId: CLIENT,
        redirectUri: "https://client.example.com/other",
        codeVerifier: VERIFIER,
      }),
    "invalid_grant",
  );
});

Deno.test("exchangeAuthCode: a code is single-use", async () => {
  const code = await mintCode();
  await exchangeAuthCode({
    code,
    clientId: CLIENT,
    redirectUri: REDIRECT,
    codeVerifier: VERIFIER,
  });
  await expectOAuthError(
    () =>
      exchangeAuthCode({
        code,
        clientId: CLIENT,
        redirectUri: REDIRECT,
        codeVerifier: VERIFIER,
      }),
    "invalid_grant",
  );
});

Deno.test("refreshTokens: rotates and detects reuse of the old token", async () => {
  const initial: TokenSet = await exchangeAuthCode({
    code: await mintCode(),
    clientId: CLIENT,
    redirectUri: REDIRECT,
    codeVerifier: VERIFIER,
  });

  const rotated = await refreshTokens({
    refreshToken: initial.refresh_token,
    clientId: CLIENT,
  });
  assert(rotated.refresh_token !== initial.refresh_token);

  // Same family across rotation.
  assertEquals(
    decodeJwt(rotated.refresh_token).fam,
    decodeJwt(initial.refresh_token).fam,
  );

  // Reusing the now-rotated token is rejected.
  await expectOAuthError(
    () =>
      refreshTokens({ refreshToken: initial.refresh_token, clientId: CLIENT }),
    "invalid_grant",
  );
});

Deno.test("refreshTokens: client mismatch is rejected", async () => {
  const initial = await exchangeAuthCode({
    code: await mintCode(),
    clientId: CLIENT,
    redirectUri: REDIRECT,
    codeVerifier: VERIFIER,
  });
  await expectOAuthError(
    () =>
      refreshTokens({
        refreshToken: initial.refresh_token,
        clientId: "https://other.example.com/id.json",
      }),
    "invalid_grant",
  );
});
