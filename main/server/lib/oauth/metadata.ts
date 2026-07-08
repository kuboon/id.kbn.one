/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414) for the MCP
 * authorization server. Served at
 * `/.well-known/oauth-authorization-server`.
 */

import { idpOrigin } from "../../config.ts";

export const DEFAULT_SCOPE = "mcp";

export const authorizationServerMetadata = () => ({
  issuer: idpOrigin,
  authorization_endpoint: `${idpOrigin}/oauth/authorize`,
  token_endpoint: `${idpOrigin}/oauth/token`,
  jwks_uri: `${idpOrigin}/.well-known/jwks.json`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  // Public clients (CIMD) authenticate with PKCE, no client secret.
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: [DEFAULT_SCOPE],
  // Client identity is a CIMD URL (no dynamic registration endpoint).
  client_id_metadata_document_supported: true,
});
