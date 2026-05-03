/**
 * RFC 7519 JWT signer using `jose.CompactSign` with ES256.
 *
 * Reuses the IdP's shared signing key (see `./signing-key.ts`).
 */

import { CompactSign } from "jose";

import { getSigningKey } from "./signing-key.ts";

export type JwtClaims = {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  [key: string]: unknown;
};

/**
 * Sign `claims` as an RFC 7519 compact JWT using ES256 and the shared
 * IdP private key.
 */
export const signJwt = async (claims: JwtClaims): Promise<string> => {
  const { keyPair, kid } = await getSigningKey();
  const payload = new TextEncoder().encode(JSON.stringify(claims));
  return await new CompactSign(payload)
    .setProtectedHeader({ alg: "ES256", typ: "JWT", kid })
    .sign(keyPair.privateKey);
};
