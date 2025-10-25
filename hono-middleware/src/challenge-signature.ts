import { base64 } from "@hexagon/base64";
import type { ChallengeType, PasskeyStoredChallenge } from "./types.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SECRET_BYTE_LENGTH = 32;
const HMAC_ENV_KEY = "HMAC_KEY";
export const CHALLENGE_COOKIE_NAME = "passkey_challenge";

let secretOverride: Uint8Array | null = null;
let secretPromise: Promise<Uint8Array> | undefined;
let hmacKeyPromise: Promise<CryptoKey> | undefined;

const toArrayBuffer = (input: Uint8Array | ArrayBuffer): ArrayBuffer => {
  if (input instanceof ArrayBuffer) {
    return input;
  }
  if (input.byteOffset === 0 && input.buffer instanceof ArrayBuffer) {
    return input.buffer;
  }
  return input.slice().buffer;
};

const base64UrlEncode = (input: Uint8Array | ArrayBuffer): string =>
  base64.fromArrayBuffer(toArrayBuffer(input), true);

const base64UrlDecode = (input: string): Uint8Array =>
  new Uint8Array(base64.toArrayBuffer(input, true));

const getSecretBytes = (): Promise<Uint8Array> => {
  if (!secretPromise) {
    secretPromise = Promise.resolve().then(() => {
      if (secretOverride) {
        return new Uint8Array(secretOverride);
      }
      let secretValue: string | null;
      try {
        secretValue = Deno.env.get(HMAC_ENV_KEY) ?? null;
      } catch (error) {
        if (error instanceof Deno.errors.PermissionDenied) {
          throw new Error(
            `Reading ${HMAC_ENV_KEY} requires --allow-env=${HMAC_ENV_KEY}`,
          );
        }
        throw error;
      }
      if (!secretValue) {
        throw new Error(`${HMAC_ENV_KEY} is not set`);
      }
      let decoded: Uint8Array;
      try {
        decoded = base64UrlDecode(secretValue);
      } catch {
        throw new Error(`${HMAC_ENV_KEY} must be a base64url value`);
      }
      if (decoded.length !== SECRET_BYTE_LENGTH) {
        throw new Error(
          `${HMAC_ENV_KEY} must decode to ${SECRET_BYTE_LENGTH} bytes`,
        );
      }
      return decoded;
    });
  }
  return secretPromise;
};

const getHmacKey = (): Promise<CryptoKey> => {
  if (!hmacKeyPromise) {
    hmacKeyPromise = (async () => {
      const secret = await getSecretBytes();
      const rawKey = toArrayBuffer(secret);
      return crypto.subtle.importKey(
        "raw",
        rawKey,
        {
          name: "HMAC",
          hash: "SHA-256",
        },
        false,
        ["sign", "verify"],
      );
    })();
  }
  return hmacKeyPromise;
};

const encodePayload = (payload: ChallengeSignaturePayload): Uint8Array =>
  encoder.encode(JSON.stringify(payload));

const decodePayload = (payloadBytes: Uint8Array): ChallengeSignaturePayload => {
  const parsed = JSON.parse(decoder.decode(payloadBytes));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid payload structure");
  }
  const candidate = parsed as Record<string, unknown>;
  const userId = typeof candidate.userId === "string" ? candidate.userId : null;
  const type =
    candidate.type === "registration" || candidate.type === "authentication"
      ? candidate.type
      : null;
  const value = candidate.value;
  if (!userId || !type || typeof value !== "object" || value === null) {
    throw new Error("Invalid challenge payload");
  }
  const challenge = (value as Record<string, unknown>).challenge;
  const origin = (value as Record<string, unknown>).origin;
  if (typeof challenge !== "string" || typeof origin !== "string") {
    throw new Error("Invalid challenge value");
  }
  return {
    userId,
    type,
    value: { challenge, origin },
  } satisfies ChallengeSignaturePayload;
};

const signPayload = async (payloadBytes: Uint8Array): Promise<string> => {
  const key = await getHmacKey();
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(payloadBytes),
  );
  return base64UrlEncode(signature);
};

const verifySignature = async (
  payloadBytes: Uint8Array,
  signature: string,
): Promise<boolean> => {
  try {
    const key = await getHmacKey();
    const signatureBytes = base64UrlDecode(signature);
    return await crypto.subtle.verify(
      "HMAC",
      key,
      toArrayBuffer(signatureBytes),
      toArrayBuffer(payloadBytes),
    );
  } catch {
    return false;
  }
};

export interface ChallengeSignaturePayload {
  userId: string;
  type: ChallengeType;
  value: PasskeyStoredChallenge;
}

export const createSignedChallengeValue = async (
  payload: ChallengeSignaturePayload,
): Promise<string> => {
  const payloadBytes = encodePayload(payload);
  const tokenPayload = base64UrlEncode(payloadBytes);
  const signature = await signPayload(payloadBytes);
  return `${tokenPayload}.${signature}`;
};

export const verifySignedChallengeValue = async (
  token: string | undefined,
  expected: { userId: string; type: ChallengeType },
): Promise<PasskeyStoredChallenge | null> => {
  if (!token) {
    return null;
  }
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
    return null;
  }
  const payloadBase64 = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  let payloadBytes: Uint8Array;
  try {
    payloadBytes = base64UrlDecode(payloadBase64);
  } catch {
    return null;
  }
  const signatureValid = await verifySignature(payloadBytes, signature);
  if (!signatureValid) {
    return null;
  }
  try {
    const payload = decodePayload(payloadBytes);
    if (payload.userId !== expected.userId || payload.type !== expected.type) {
      return null;
    }
    return payload.value;
  } catch {
    return null;
  }
};

const resetSecretCache = () => {
  secretPromise = undefined;
  hmacKeyPromise = undefined;
};

export const challengeSignatureInternals = {
  setSecretOverride: (secret: Uint8Array | null) => {
    secretOverride = secret ? new Uint8Array(secret) : null;
    resetSecretCache();
  },
  resetSecretCache,
  getEnvKeyName: () => HMAC_ENV_KEY,
  getSecretByteLength: () => SECRET_BYTE_LENGTH,
};
