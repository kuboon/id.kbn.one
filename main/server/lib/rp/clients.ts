/**
 * Authorize RP servers for `private_key_jwt` client authentication using the
 * existing `AUTHORIZE_WHITELIST`.
 *
 * An RP's `clientId` is its origin (e.g. `https://rp.example.com`). It is
 * allowed iff that origin is in `AUTHORIZE_WHITELIST`, and its public key is
 * fetched from the RP's own JWKS at `${origin}/.well-known/jwks.json` — the
 * mirror image of how an RP verifies the IdP. There is no separate key
 * registry: the RP rotates keys by updating its own JWKS.
 */

import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";

import { authorizeWhitelist } from "../../config.ts";

/** True when `clientId` (an origin) is a whitelisted RP. */
export const isAllowedRpClient = (clientId: string): boolean =>
  authorizeWhitelist.includes(clientId);

/**
 * Whether the caller is the IdP itself rather than a cross-origin RP. True
 * when there is no `Origin` (same-origin request, e.g. the IdP's own `/me`
 * page) or it equals the IdP origin. Such callers are not domain-scoped.
 */
export const callerIsIdp = (
  callerOrigin: string | undefined,
  idp: string,
): boolean => !callerOrigin || callerOrigin === idp;

/**
 * Whether a subscription registered from `subscriptionOrigin` belongs to the
 * RP identified by `clientId` — i.e. registered from the RP's own domain or a
 * subdomain of it. Scheme/port are ignored; matching is by hostname. Returns
 * false for a missing or unparseable origin.
 */
export const originMatchesClient = (
  subscriptionOrigin: string | undefined,
  clientId: string,
): boolean => {
  if (!subscriptionOrigin) return false;
  let subHost: string;
  let rpHost: string;
  try {
    subHost = new URL(subscriptionOrigin).hostname;
    rpHost = new URL(clientId).hostname;
  } catch {
    return false;
  }
  return subHost === rpHost || subHost.endsWith("." + rpHost);
};

const jwksCache = new Map<string, JWTVerifyGetKey>();

/**
 * jose key resolver over the RP's published JWKS. `createRemoteJWKSet`
 * fetches lazily and caches/rotates keys on its own, so the result is reused
 * per origin.
 *
 * @throws {TypeError} if `clientId` is not a valid absolute origin.
 */
export const rpKeySet = (clientId: string): JWTVerifyGetKey => {
  let set = jwksCache.get(clientId);
  if (!set) {
    set = createRemoteJWKSet(new URL("/.well-known/jwks.json", clientId));
    jwksCache.set(clientId, set);
  }
  return set;
};
