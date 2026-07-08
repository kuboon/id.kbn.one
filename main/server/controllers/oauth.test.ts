import { assert, assertEquals } from "@std/assert";

import router from "../router.ts";
import { s256Challenge } from "../lib/oauth/pkce.ts";
import { issueAuthCode } from "../lib/oauth/tokens.ts";

const VERIFIER = "abcdefghijklmnopqrstuvwxyz0123456789-._~ABCD";
const CLIENT = "https://client.example.com/oauth/metadata.json";
const REDIRECT = "https://client.example.com/cb";
const RESOURCE = "https://mcp.example.com";

const form = (body: Record<string, string>) =>
  router.fetch(
    new Request("http://localhost/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    }),
  );

Deno.test("GET /.well-known/oauth-authorization-server returns RFC 8414 metadata", async () => {
  const res = await router.fetch(
    new Request("http://localhost/.well-known/oauth-authorization-server"),
  );
  assertEquals(res.status, 200);
  const meta = await res.json();
  assertEquals(meta.token_endpoint, "http://localhost:3000/oauth/token");
  assertEquals(meta.code_challenge_methods_supported, ["S256"]);
  assert(meta.grant_types_supported.includes("authorization_code"));
  assert(meta.grant_types_supported.includes("refresh_token"));
});

Deno.test("POST /oauth/token exchanges an authorization_code", async () => {
  const code = await issueAuthCode({
    sub: "user-1",
    clientId: CLIENT,
    redirectUri: REDIRECT,
    codeChallenge: await s256Challenge(VERIFIER),
    resource: RESOURCE,
    scope: "mcp",
  });
  const res = await form({
    grant_type: "authorization_code",
    code,
    client_id: CLIENT,
    redirect_uri: REDIRECT,
    code_verifier: VERIFIER,
  });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assertEquals(body.token_type, "Bearer");
  assert(body.access_token && body.refresh_token);
});

Deno.test("POST /oauth/token rejects an unsupported grant_type", async () => {
  const res = await form({ grant_type: "password" });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "unsupported_grant_type");
});

Deno.test("POST /oauth/token rejects a bad PKCE verifier", async () => {
  const code = await issueAuthCode({
    sub: "user-1",
    clientId: CLIENT,
    redirectUri: REDIRECT,
    codeChallenge: await s256Challenge(VERIFIER),
    resource: RESOURCE,
    scope: "mcp",
  });
  const res = await form({
    grant_type: "authorization_code",
    code,
    client_id: CLIENT,
    redirect_uri: REDIRECT,
    code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier",
  });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "invalid_grant");
});
