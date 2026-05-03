/**
 * GET /.well-known/jwks.json — public JSON Web Key Set (RFC 7517) for the
 * IdP's JWS signing key. Suitable for `jose.createRemoteJWKSet`.
 */

import { getSigningKey } from "../lib/signing-key.ts";

export const jwksAction = async (): Promise<Response> => {
  const { publicJwk } = await getSigningKey();
  return new Response(JSON.stringify({ keys: [publicJwk] }), {
    headers: {
      "content-type": "application/jwk-set+json",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
};
