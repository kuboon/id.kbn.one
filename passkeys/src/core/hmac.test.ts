import { assertEquals, assertRejects } from "@std/assert";
import createHmacHelpers from "./hmac.ts";

const makeSecret = () => {
  const arr = new Uint8Array(32);
  for (let i = 0; i < arr.length; i++) arr[i] = i + 1;
  return arr.toBase64({ alphabet: "base64url", omitPadding: true });
};

Deno.test("sign and verify roundtrip", async () => {
  const secret = makeSecret();
  const getSecret = () => Promise.resolve(secret);
  const { signToken, verifyToken } = createHmacHelpers(getSecret);
  const payload = { foo: "bar", n: 1 } as Record<string, unknown>;
  const token = await signToken(payload);
  const parsed = await verifyToken(token);
  assertEquals(parsed.foo, "bar");
  assertEquals(parsed.n, 1);
});

Deno.test("invalid signature throws", async () => {
  const secret = makeSecret();
  const getSecret = () => Promise.resolve(secret);
  const { signToken, verifyToken } = createHmacHelpers(getSecret);
  const token = await signToken({ a: 1 });
  // tamper with token payload
  const parts = token.split(".");
  const payload = parts[0];
  const sig = parts[1];
  const tampered = payload.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  await assertRejects(() => verifyToken(`${tampered}.${sig}`));
});

Deno.test("expired token throws", async () => {
  const secret = makeSecret();
  const getSecret = () => Promise.resolve(secret);
  const { signToken, verifyToken } = createHmacHelpers(getSecret);
  const token = await signToken({ exp: Math.floor(Date.now() / 1000) - 10 });
  await assertRejects(() => verifyToken(token));
});
