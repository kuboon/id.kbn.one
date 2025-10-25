import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertStrictEquals,
} from "@std/assert";
import {
  CHALLENGE_COOKIE_NAME,
  challengeSignatureInternals,
  createSignedChallengeValue,
  verifySignedChallengeValue,
} from "./challenge-signature.ts";

const createTestSecret = (seed: number): Uint8Array => {
  const secret = new Uint8Array(
    challengeSignatureInternals.getSecretByteLength(),
  );
  for (let i = 0; i < secret.length; i++) {
    secret[i] = (seed + i) % 256;
  }
  return secret;
};

Deno.test("creates and verifies signed challenge value", async () => {
  const secret = createTestSecret(10);
  try {
    challengeSignatureInternals.setSecretOverride(secret);
    const payload = {
      userId: "user-123",
      type: "registration" as const,
      value: { challenge: "test-challenge", origin: "https://example.com" },
    };
    const token = await createSignedChallengeValue(payload);
    const verified = await verifySignedChallengeValue(token, {
      userId: payload.userId,
      type: payload.type,
    });
    assertExists(verified);
    assertEquals(verified.challenge, payload.value.challenge);
    assertEquals(verified.origin, payload.value.origin);
    assertEquals(CHALLENGE_COOKIE_NAME, "passkey_challenge");
  } finally {
    challengeSignatureInternals.setSecretOverride(null);
  }
});

Deno.test("rejects mismatched identifiers", async () => {
  try {
    challengeSignatureInternals.setSecretOverride(createTestSecret(20));
    const token = await createSignedChallengeValue({
      userId: "user-1",
      type: "authentication",
      value: { challenge: "c2", origin: "https://auth.example" },
    });
    const result = await verifySignedChallengeValue(token, {
      userId: "user-2",
      type: "authentication",
    });
    assertStrictEquals(result, null);
    const typeMismatch = await verifySignedChallengeValue(token, {
      userId: "user-1",
      type: "registration",
    });
    assertStrictEquals(typeMismatch, null);
  } finally {
    challengeSignatureInternals.setSecretOverride(null);
  }
});

Deno.test("detects tampered signatures", async () => {
  try {
    challengeSignatureInternals.setSecretOverride(createTestSecret(30));
    const token = await createSignedChallengeValue({
      userId: "user-3",
      type: "authentication",
      value: { challenge: "orig", origin: "https://site" },
    });
    const parts = token.split(".");
    assertEquals(parts.length, 2);
    const tamperedSignature = (parts[1][0] === "A" ? "B" : "A") +
      parts[1].slice(1);
    assertNotEquals(parts[1], tamperedSignature);
    const tamperedToken = `${parts[0]}.${tamperedSignature}`;
    const verified = await verifySignedChallengeValue(tamperedToken, {
      userId: "user-3",
      type: "authentication",
    });
    assertStrictEquals(verified, null);
  } finally {
    challengeSignatureInternals.setSecretOverride(null);
  }
});
