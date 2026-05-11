/**
 * PKCE (RFC 7636) S256 challenge verification.
 *
 * `code_challenge = BASE64URL(SHA256(code_verifier))`. Verifier length must
 * be 43–128 characters from the unreserved set.
 */

import { encodeBase64Url } from "@std/encoding/base64url";

const verifierPattern = /^[A-Za-z0-9_\-.~]{43,128}$/;

export const verifyPkceS256 = async (
  verifier: string,
  challenge: string,
): Promise<boolean> => {
  if (!verifierPattern.test(verifier)) return false;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return encodeBase64Url(new Uint8Array(digest)) === challenge;
};
