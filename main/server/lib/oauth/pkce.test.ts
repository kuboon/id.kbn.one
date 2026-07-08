import { assert, assertEquals } from "@std/assert";

import { s256Challenge, verifyPkceS256 } from "./pkce.ts";

const VERIFIER = "abcdefghijklmnopqrstuvwxyz0123456789-._~ABCD"; // 43 chars

Deno.test("verifyPkceS256: matching verifier/challenge passes", async () => {
  const challenge = await s256Challenge(VERIFIER);
  assert(await verifyPkceS256(VERIFIER, challenge));
});

Deno.test("verifyPkceS256: wrong verifier fails", async () => {
  const challenge = await s256Challenge(VERIFIER);
  assertEquals(await verifyPkceS256(VERIFIER + "X", challenge), false);
});

Deno.test("verifyPkceS256: malformed verifier (too short) fails", async () => {
  const short = "tooshort";
  const challenge = await s256Challenge(short);
  assertEquals(await verifyPkceS256(short, challenge), false);
});

Deno.test("verifyPkceS256: empty challenge fails", async () => {
  assertEquals(await verifyPkceS256(VERIFIER, ""), false);
});
