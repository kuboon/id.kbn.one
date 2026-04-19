/**
 * Server-side DPoP proof verification per
 * [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449).
 *
 * Use {@link verifyDpopProofFromRequest} when you have a `Request` object, or
 * {@link verifyDpopProof} when you only have the raw header and request
 * metadata (e.g. behind a custom transport or load balancer).
 *
 * @example Hono middleware
 * ```ts
 * import { verifyDpopProofFromRequest } from "@kuboon/dpop/server.ts";
 *
 * app.use(async (c, next) => {
 *   const result = await verifyDpopProofFromRequest(c.req.raw, {
 *     checkReplay: (jti) => replayCache.addIfAbsent(jti),
 *   });
 *   if (!result.valid) return c.text(result.error, 401);
 *   c.set("dpopJwk", result.jwk);
 *   await next();
 * });
 * ```
 *
 * @module
 */
import type { DpopProofRequest, VerifyDpopProofResult } from "./types.ts";
import type { DpopJwtPayload, VerifyDpopProofOptions } from "../types.ts";
import {
  computeAth,
  computeThumbprint,
  normalizeHtu,
  normalizeMethod,
} from "../common.ts";
import { decodeBase64Url } from "@std/encoding/base64url";

export type { DpopProofRequest, VerifyDpopProofResult } from "./types.ts";
export type {
  DpopAccessTokenBinding,
  DpopJwtPayload,
  VerifyDpopProofOptions,
} from "../types.ts";

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

/**
 * Verify a DPoP proof against a specific HTTP method + URL.
 *
 * Performs the checks mandated by RFC 9449 §4.3:
 *
 * 1. Compact JWT format, `typ: dpop+jwt`, `alg: ES256`.
 * 2. Embedded `jwk` is a valid EC P-256 public key.
 * 3. Signature verifies against that key.
 * 4. `htm` matches the normalized request method.
 * 5. `htu` matches the normalized request URL (no fragment).
 * 6. `jti` is a non-empty string.
 * 7. `iat` is within `[now - maxAgeSeconds, now + clockSkewSeconds]`.
 * 8. `checkReplay(jti)` returns truthy.
 *
 * On success the decoded payload and public JWK are returned so callers can
 * perform further policy checks (e.g. matching the JWK thumbprint against a
 * session binding, enforcing `nonce`, checking `ath`).
 *
 * @param request - The proof plus the method and URL it must be bound to.
 * @param options_ - Tuning knobs; see {@link VerifyDpopProofOptions}.
 * @returns A discriminated union — inspect `valid` to narrow.
 */
export const verifyDpopProof = async (
  request: DpopProofRequest,
  options_?: VerifyDpopProofOptions,
): Promise<VerifyDpopProofResult> => {
  const options: Required<Omit<VerifyDpopProofOptions, "accessToken">> = Object
    .assign(
      {
        maxAgeSeconds: 300,
        clockSkewSeconds: 60,
        checkReplay: () => true,
        now: Math.floor(Date.now() / 1000),
      },
      options_ ?? {},
    );
  const parts = request.proof.split(".");
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
  // Import public key and verify signature before trusting payload fields
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
  let signatureBuffer: ArrayBuffer;
  try {
    const decodedSignature = base64UrlDecode(parts[2]);
    const u8 = new Uint8Array(decodedSignature);
    signatureBuffer = u8.buffer.slice(
      u8.byteOffset,
      u8.byteOffset + u8.byteLength,
    );
  } catch {
    return { valid: false, error: "invalid-signature" };
  }
  const signingInput = textEncoder.encode(`${parts[0]}.${parts[1]}`);
  const signatureValid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    signatureBuffer,
    signingInput,
  );
  if (!signatureValid) {
    return { valid: false, error: "invalid-signature" };
  }

  const expectedMethod = normalizeMethod(request.method);
  if (payload.htm?.toUpperCase() !== expectedMethod) {
    return { valid: false, error: "method-mismatch" };
  }

  let expectedHtu: string;
  try {
    expectedHtu = normalizeHtu(request.url);
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

  const maxAge = options.maxAgeSeconds;
  const clockSkew = options.clockSkewSeconds;
  const now = options.now;

  if (payload.iat > now + clockSkew) {
    return { valid: false, error: "future-iat" };
  }
  if (now - payload.iat > maxAge) {
    return { valid: false, error: "expired" };
  }

  const ok = await options.checkReplay(payload.jti);
  if (!ok) {
    return { valid: false, error: "replay-detected" };
  }

  if (options_?.accessToken) {
    const { token, claims } = options_.accessToken;
    const proofJkt = await computeThumbprint(header.jwk);
    if (claims.cnf?.jkt !== proofJkt) {
      return { valid: false, error: "jkt-mismatch" };
    }
    const expectedAth = await computeAth(token);
    if (payload.ath !== expectedAth) {
      return { valid: false, error: "ath-mismatch" };
    }
  }

  return {
    valid: true,
    parts: parts as [string, string, string],
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

/**
 * Convenience wrapper around {@link verifyDpopProof} that reads the `DPoP`
 * header, method, and URL from a `Request`.
 *
 * @returns `{ valid: false, error: "missing-dpop-header" }` if no `DPoP`
 *   header is present; otherwise the result of {@link verifyDpopProof}.
 */
export const verifyDpopProofFromRequest = async (
  req: Request,
  options?: VerifyDpopProofOptions,
): Promise<VerifyDpopProofResult> => {
  const header = req.headers.get("dpop") ?? req.headers.get("DPoP");
  if (!header) {
    return { valid: false, error: "missing-dpop-header" };
  }

  return await verifyDpopProof(
    {
      proof: header,
      method: req.method,
      url: req.url,
    },
    options,
  );
};
