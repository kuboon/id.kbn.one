/**
 * GET /.well-known/openid-configuration — OpenID Connect Discovery 1.0
 * metadata document describing this IdP's endpoints and capabilities.
 *
 * Public clients only: Authorization Code flow with PKCE (S256). No
 * client_secret, so `token_endpoint_auth_methods_supported: ["none"]`.
 * The simple DPoP-jkt flow used by first-party RPs is a separate path
 * and intentionally not advertised here.
 */

import { idpOrigin } from "#server/config.ts";

export const openidConfigurationAction = (): Response => {
  const config = {
    issuer: idpOrigin,
    authorization_endpoint: `${idpOrigin}/authorize`,
    token_endpoint: `${idpOrigin}/token`,
    userinfo_endpoint: `${idpOrigin}/userinfo`,
    jwks_uri: `${idpOrigin}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["ES256"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid", "profile", "email"],
    claims_supported: [
      "iss",
      "sub",
      "aud",
      "exp",
      "iat",
      "auth_time",
      "nonce",
      "jti",
      "email",
      "email_verified",
      "preferred_username",
      "name",
    ],
  };
  return new Response(JSON.stringify(config), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
};
