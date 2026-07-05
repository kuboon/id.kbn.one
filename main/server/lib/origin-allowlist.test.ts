import { assert, assertEquals } from "@std/assert";

import { buildOriginAllowlist } from "./origin-allowlist.ts";

const list = buildOriginAllowlist([
  "kbn.one",
  "localhost",
  "https://sub.example.com", // full-origin entry is normalized to its hostname
]);

Deno.test("originAllowed: apex host matches", () => {
  assert(list.originAllowed("https://kbn.one"));
});

Deno.test("originAllowed: subdomains (any depth) match", () => {
  assert(list.originAllowed("https://app.kbn.one"));
  assert(list.originAllowed("https://a.b.kbn.one"));
});

Deno.test("originAllowed: scheme and port are ignored", () => {
  assert(list.originAllowed("http://kbn.one"));
  assert(list.originAllowed("http://localhost:3000"));
  assert(list.originAllowed("http://localhost:8000"));
});

Deno.test("originAllowed: a full-origin entry is matched by hostname", () => {
  assert(list.originAllowed("https://sub.example.com"));
  assert(list.originAllowed("https://deep.sub.example.com"));
  // A sibling host not under the entry's hostname is rejected.
  assertEquals(list.originAllowed("https://example.com"), false);
});

Deno.test("originAllowed: unrelated and look-alike hosts are rejected", () => {
  assertEquals(list.originAllowed("https://evil.com"), false);
  // Suffix that isn't a dot-delimited subdomain must not match.
  assertEquals(list.originAllowed("https://evilkbn.one"), false);
  // Whitelisted host appearing as a non-suffix label must not match.
  assertEquals(list.originAllowed("https://kbn.one.attacker.com"), false);
});

Deno.test("originAllowed: invalid origin string is rejected", () => {
  assertEquals(list.originAllowed("not a url"), false);
  assertEquals(list.originAllowed(""), false);
});

Deno.test("hostAllowed: works on bare hostnames", () => {
  assert(list.hostAllowed("app.kbn.one"));
  assert(list.hostAllowed("kbn.one"));
  assertEquals(list.hostAllowed("evil.com"), false);
});

Deno.test("buildOriginAllowlist: empty / blank entries never match", () => {
  const empty = buildOriginAllowlist(["", "   "]);
  assertEquals(empty.originAllowed("https://kbn.one"), false);
});
