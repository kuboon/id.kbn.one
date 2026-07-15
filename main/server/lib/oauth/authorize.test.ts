import { assert, assertEquals } from "@std/assert";
import { decodeJwt } from "jose";

import { s256Challenge } from "./pkce.ts";
import {
  completeAuthorization,
  exchangeAuthCode,
  issueAuthzRequest,
  OAuthError,
} from "./tokens.ts";

const VERIFIER = "abcdefghijklmnopqrstuvwxyz0123456789-._~ABCD";
const CLIENT = "https://client.example.com/oauth/metadata.json";
const REDIRECT = "https://client.example.com/cb";
const RESOURCE = "https://mcp.example.com";

const mintRequest = async (state?: string) =>
  await issueAuthzRequest({
    clientId: CLIENT,
    redirectUri: REDIRECT,
    codeChallenge: await s256Challenge(VERIFIER),
    resource: RESOURCE,
    scope: "mcp",
    state,
  });

Deno.test("completeAuthorization: approve returns a redirect with a usable code", async () => {
  const { redirect } = await completeAuthorization({
    requestToken: await mintRequest("xyz"),
    userId: "user-1",
    decision: "approve",
  });
  const url = new URL(redirect);
  assertEquals(url.origin + url.pathname, REDIRECT);
  assertEquals(url.searchParams.get("state"), "xyz");
  const code = url.searchParams.get("code");
  assert(code);

  // The issued code exchanges successfully and carries the bound user/resource.
  const tokens = await exchangeAuthCode({
    code: code!,
    clientId: CLIENT,
    redirectUri: REDIRECT,
    codeVerifier: VERIFIER,
  });
  const access = decodeJwt(tokens.access_token);
  assertEquals(access.sub, "user-1");
  assertEquals(access.aud, RESOURCE);
});

Deno.test("completeAuthorization: deny returns access_denied (no code)", async () => {
  const { redirect } = await completeAuthorization({
    requestToken: await mintRequest("s1"),
    userId: "user-1",
    decision: "deny",
  });
  const url = new URL(redirect);
  assertEquals(url.searchParams.get("error"), "access_denied");
  assertEquals(url.searchParams.get("state"), "s1");
  assertEquals(url.searchParams.get("code"), null);
});

Deno.test("completeAuthorization: a tampered/invalid request token is rejected", async () => {
  try {
    await completeAuthorization({
      requestToken: "not-a-jwt",
      userId: "user-1",
      decision: "approve",
    });
    throw new Error("expected OAuthError");
  } catch (e) {
    assert(e instanceof OAuthError);
    assertEquals(e.error, "invalid_request");
  }
});

Deno.test("GET /oauth/authorize without client_id renders an error", async () => {
  const { default: router } = await import("../../router.ts");
  const res = await router.fetch(
    new Request("http://localhost/oauth/authorize"),
  );
  assertEquals(res.status, 400);
  assert((await res.text()).includes("client_id"));
});
