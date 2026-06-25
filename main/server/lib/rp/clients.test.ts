import { assert, assertEquals } from "@std/assert";

import { originMatchesClient } from "./clients.ts";

const CLIENT = "https://rp.example.com";

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
