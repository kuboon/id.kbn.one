import { assert, assertEquals } from "@std/assert";

import { callerIsIdp, clientOrigin, originMatchesClient } from "./clients.ts";

const CLIENT = "https://rp.example.com";

Deno.test("clientOrigin: bare host becomes an https origin", () => {
  assertEquals(clientOrigin("rp.example.com"), "https://rp.example.com");
});

Deno.test("clientOrigin: a full origin is returned unchanged", () => {
  assertEquals(
    clientOrigin("https://rp.example.com"),
    "https://rp.example.com",
  );
  assertEquals(clientOrigin("http://localhost:3000"), "http://localhost:3000");
});

Deno.test("originMatchesClient: a bare-host clientId (iss without scheme) matches", () => {
  const bare = "rp.example.com";
  assert(originMatchesClient("https://rp.example.com", bare));
  assert(originMatchesClient("https://app.rp.example.com", bare));
  assertEquals(originMatchesClient("https://evil.com", bare), false);
});

Deno.test("originMatchesClient: exact host matches", () => {
  assert(originMatchesClient("https://rp.example.com", CLIENT));
  // Scheme and port are ignored — matching is by hostname.
  assert(originMatchesClient("http://rp.example.com:8443", CLIENT));
});

Deno.test("originMatchesClient: subdomains match", () => {
  assert(originMatchesClient("https://app.rp.example.com", CLIENT));
  assert(originMatchesClient("https://a.b.rp.example.com", CLIENT));
});

Deno.test("originMatchesClient: unrelated or look-alike domains do not match", () => {
  assertEquals(originMatchesClient("https://evil.com", CLIENT), false);
  // Suffix that isn't a dot-delimited subdomain must not match.
  assertEquals(originMatchesClient("https://notrp.example.com", CLIENT), false);
  // Parent domain must not match a more specific client.
  assertEquals(
    originMatchesClient("https://example.com", CLIENT),
    false,
  );
});

Deno.test("originMatchesClient: missing or invalid origin is false", () => {
  assertEquals(originMatchesClient(undefined, CLIENT), false);
  assertEquals(originMatchesClient("", CLIENT), false);
  assertEquals(originMatchesClient("not a url", CLIENT), false);
});

Deno.test("callerIsIdp: same-origin (no Origin) or the IdP origin is the IdP", () => {
  const IDP = "https://id.kbn.one";
  assert(callerIsIdp(undefined, IDP));
  assert(callerIsIdp(IDP, IDP));
});

Deno.test("callerIsIdp: a cross-origin RP is not the IdP", () => {
  const IDP = "https://id.kbn.one";
  assertEquals(callerIsIdp("https://rp.example.com", IDP), false);
});
