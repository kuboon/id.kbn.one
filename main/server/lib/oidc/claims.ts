/**
 * Claim shaping for OIDC responses.
 *
 * The IdP only stores a passkey-chosen `userId`; standard OIDC consumers
 * (e.g. Outline, Grafana) require `email`, `name`, `preferred_username`.
 * We synthesize them deterministically from `userId` so existing user
 * records keep working without a schema migration.
 *
 * Email is `<userId>@<idp host>`. With single-tenant downstream apps that
 * group users by email domain, this puts every IdP user in the same
 * downstream team — which is the intended behaviour here.
 */

import { idpOrigin } from "../../config.ts";

const idpHost = new URL(idpOrigin).hostname;

export interface UserClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  name?: string;
}

export const synthesizeEmail = (userId: string): string =>
  `${userId}@${idpHost}`;

const splitScopes = (scope: string): Set<string> =>
  new Set(scope.split(/\s+/).filter(Boolean));

/**
 * Build the claim set for `/userinfo` and for inclusion in the id_token.
 * Gated by the granted scopes (`profile`, `email`) per OIDC Core §5.4.
 */
export const buildUserClaims = (
  userId: string,
  scope: string,
): UserClaims => {
  const scopes = splitScopes(scope);
  const claims: UserClaims = { sub: userId };
  if (scopes.has("profile")) {
    claims.preferred_username = userId;
    claims.name = userId;
  }
  if (scopes.has("email")) {
    claims.email = synthesizeEmail(userId);
    claims.email_verified = false;
  }
  return claims;
};
