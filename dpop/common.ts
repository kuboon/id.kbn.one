import { encodeBase64Url } from "@std/encoding/base64url";

const toUint8Array = (input: ArrayBuffer | Uint8Array): Uint8Array =>
  input instanceof Uint8Array ? input : new Uint8Array(input);

export const base64UrlEncode = (input: ArrayBuffer | Uint8Array): string =>
  encodeBase64Url(toUint8Array(input));

export const normalizeMethod = (method: string): string =>
  method.trim().toUpperCase();

export const normalizeHtu = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
};

/**
 * Compute the RFC 7638 JWK SHA-256 thumbprint of a public JWK.
 * Used as a stable identifier for the key (e.g. session key in DPoP).
 *
 * Only EC (P-256) keys are supported; the canonical form uses the
 * required members `crv`, `kty`, `x`, `y` in lexicographic order.
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
