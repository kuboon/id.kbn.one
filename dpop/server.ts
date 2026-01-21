import { VerifyDpopProofOptions, VerifyDpopProofResult, DpopJwtPayload } from "./types.ts";
import { normalizeMethod, normalizeHtu, sha256Base64Url } from "./common.ts";
import { decodeBase64Url } from "@std/encoding/base64url";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const base64UrlDecode = (input: string): Uint8Array =>
  new Uint8Array(decodeBase64Url(input));

const parseJwtSection = (segment: string) => {
  const bytes = base64UrlDecode(segment);
  const decoded = textDecoder.decode(bytes);
  return JSON.parse(decoded);
};

const isValidPublicJwk = (jwk: unknown): jwk is JsonWebKey => {
  if (!jwk || typeof jwk !== "object") {
    return false;
  }
  const record = jwk as Record<string, unknown>;
  return (
    record.kty === "EC" &&
    record.crv === "P-256" &&
    typeof record.x === "string" &&
    typeof record.y === "string"
  );
};

const timingSafeEqual = (a: string, b: string): boolean => {
  const aBytes = textEncoder.encode(a);
  const bBytes = textEncoder.encode(b);
  if (aBytes.length !== bBytes.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    result |= aBytes[i]! ^ bBytes[i]!;
  }
  return result === 0;
};

export const verifyDpopProof = async (
  options: VerifyDpopProofOptions,
): Promise<VerifyDpopProofResult> => {
  const parts = options.proof.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "invalid-format" };
  }

  let header: { alg?: string; typ?: string; jwk?: unknown };
  let payload: DpopJwtPayload & Record<string, unknown>;
  try {
    header = parseJwtSection(parts[0]!) as typeof header;
    payload = parseJwtSection(parts[1]!) as typeof payload;
  } catch {
    return { valid: false, error: "invalid-json" };
  }

  if (header.typ?.toLowerCase() !== "dpop+jwt") {
    return { valid: false, error: "invalid-type" };
  }
  if (header.alg !== "ES256") {
    return { valid: false, error: "unsupported-algorithm" };
  }
  if (!isValidPublicJwk(header.jwk)) {
    return { valid: false, error: "invalid-jwk" };
  }

  const expectedMethod = normalizeMethod(options.method);
  if (payload.htm?.toUpperCase() !== expectedMethod) {
    return { valid: false, error: "method-mismatch" };
  }

  let expectedHtu: string;
  try {
    expectedHtu = normalizeHtu(options.url);
  } catch {
    return { valid: false, error: "invalid-url" };
  }
  if (payload.htu !== expectedHtu) {
    return { valid: false, error: "url-mismatch" };
  }

  if (typeof payload.jti !== "string" || !payload.jti) {
    return { valid: false, error: "invalid-jti" };
  }

  if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) {
    return { valid: false, error: "invalid-iat" };
  }

  const maxAge = options.maxAgeSeconds ?? 300;
  const clockSkew = options.clockSkewSeconds ?? 60;
  const now = options.now ?? Math.floor(Date.now() / 1000);

  if (payload.iat > now + clockSkew) {
    return { valid: false, error: "future-iat" };
  }
  if (now - payload.iat > maxAge) {
    return { valid: false, error: "expired" };
  }

  if (options.nonce !== undefined) {
    if (payload.nonce !== options.nonce) {
      return { valid: false, error: "nonce-mismatch" };
    }
  }

  if (options.accessToken) {
    if (typeof payload.ath !== "string") {
      return { valid: false, error: "missing-ath" };
    }
    const expectedAth = await sha256Base64Url(options.accessToken);
    if (!timingSafeEqual(payload.ath, expectedAth)) {
      return { valid: false, error: "ath-mismatch" };
    }
  }

  if (options.checkReplay) {
    const ok = await options.checkReplay(payload.jti);
    if (!ok) {
      return { valid: false, error: "replay-detected" };
    }
  }

  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      "jwk",
      header.jwk,
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      false,
      ["verify"],
    );
  } catch {
    return { valid: false, error: "invalid-jwk" };
  }

  const decodedSignature = base64UrlDecode(parts[2]!);
  const signatureBytes = new Uint8Array(decodedSignature.length);
  signatureBytes.set(decodedSignature);
  const signingInput = textEncoder.encode(`${parts[0]!}.${parts[1]!}`);
  const signatureValid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    signatureBytes,
    signingInput,
  );
  if (!signatureValid) {
    return { valid: false, error: "invalid-signature" };
  }

  return {
    valid: true,
    payload: {
      htm: payload.htm,
      htu: payload.htu,
      jti: payload.jti,
      iat: payload.iat,
      nonce: payload.nonce,
      ath: payload.ath,
    },
    jwk: header.jwk,
  };
};

