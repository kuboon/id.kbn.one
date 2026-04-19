/**
 * Shared helpers used by both the client and server entry points. Safe to
 * import from any runtime that has `crypto.subtle` available.
 *
 * @module
 */
import { encodeBase64Url } from "@std/encoding/base64url";

const toUint8Array = (input: ArrayBuffer | Uint8Array): Uint8Array =>
  input instanceof Uint8Array ? input : new Uint8Array(input);

/** Base64url-encode a byte buffer (no padding). */
export const base64UrlEncode = (input: ArrayBuffer | Uint8Array): string =>
  encodeBase64Url(toUint8Array(input));

/**
 * Normalize an HTTP method for use in the `htm` claim: trimmed and
 * upper-cased per RFC 9449 §4.2.
 */
export const normalizeMethod = (method: string): string =>
  method.trim().toUpperCase();

/**
 * Normalize a URL into the form used by the `htu` claim: scheme + host +
 * path + query, with the fragment stripped (RFC 9449 §4.2).
 *
 * @throws {TypeError} if `url` is not a valid absolute URL.
 */
export const normalizeHtu = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
};

/**
 * Compute the `ath` claim value for a DPoP-bound access token: the
 * base64url-encoded SHA-256 hash of the ASCII access-token string, per
 * [RFC 9449 §4.2](https://www.rfc-editor.org/rfc/rfc9449#section-4.2).
 *
 * @example
 * ```ts
 * const ath = await computeAth(accessToken);
 * if (proof.payload.ath !== ath) throw new Error("ath mismatch");
 * ```
 */
export const computeAth = async (accessToken: string): Promise<string> => {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(accessToken),
  );
  return base64UrlEncode(new Uint8Array(hash));
};

/**
 * Compute the RFC 7638 JWK SHA-256 thumbprint of a public JWK, base64url-
 * encoded. Used as a stable identifier for the key — e.g. the `jkt`
 * confirmation claim bound to a DPoP session or access token.
 *
 * Only EC (P-256) keys are supported; the canonical form uses the required
 * members `crv`, `kty`, `x`, `y` in lexicographic order.
 *
 * @example
 * ```ts
 * const jkt = await computeThumbprint(publicJwk);
 * // "nZr... (43 chars)"
 * ```
 */
export const computeThumbprint = async (jwk: JsonWebKey): Promise<string> => {
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return base64UrlEncode(new Uint8Array(hash));
};
