/**
 * PKCE (RFC 7636) — S256 only, as required by OAuth 2.1 / the MCP
 * authorization spec.
 */

import { encodeBase64Url } from "@std/encoding/base64url";

/** RFC 7636 §4.1 `code_verifier` charset and length. */
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

/** base64url(SHA-256(verifier)) — the expected `code_challenge` for S256. */
export const s256Challenge = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return encodeBase64Url(new Uint8Array(digest));
};

/**
 * Verify a `code_verifier` against a stored S256 `code_challenge`. Returns
 * false for a malformed verifier or any mismatch.
 */
export const verifyPkceS256 = async (
  verifier: string,
  challenge: string,
): Promise<boolean> => {
  if (!VERIFIER_RE.test(verifier) || !challenge) return false;
  return (await s256Challenge(verifier)) === challenge;
};
