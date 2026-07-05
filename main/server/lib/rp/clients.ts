/**
 * Authorize RP servers for `private_key_jwt` client authentication using the
 * existing `AUTHORIZE_WHITELIST`.
 *
 * An RP's `clientId` is its origin (e.g. `https://rp.example.com`) or just its
 * bare host (e.g. `rp.example.com`). It is allowed iff its host is whitelisted
 * by `AUTHORIZE_WHITELIST` (the host or a subdomain of it), and its public key
 * is fetched from the RP's own JWKS at `${origin}/.well-known/jwks.json` — the
 * mirror image of how an RP verifies the IdP. There is no separate key
 * registry: the RP rotates keys by updating its own JWKS.
 */

import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";

import { originAllowlist } from "../../config.ts";

/**
 * Normalize a `clientId` to an absolute origin. Accepts a full origin
 * (returned as-is) or a bare host (assumed `https://`), so both `iss` forms
 * work.
 */
export const clientOrigin = (clientId: string): string =>
  clientId.includes("://") ? clientId : `https://${clientId}`;

/** True when `clientId` (origin or bare host) is a whitelisted RP host or
 * subdomain. */
export const isAllowedRpClient = (clientId: string): boolean =>
  originAllowlist.originAllowed(clientOrigin(clientId));

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
    rpHost = new URL(clientOrigin(clientId)).hostname;
  } catch {
    return false;
  }
  return subHost === rpHost || subHost.endsWith("." + rpHost);
};

const jwksCache = new Map<string, JWTVerifyGetKey>();

/**
 * jose key resolver over the RP's published JWKS. `createRemoteJWKSet`
 * fetches lazily and caches/rotates keys on its own, so the result is reused
 * per origin. Accepts a full origin or a bare host for `clientId`.
 */
export const rpKeySet = (clientId: string): JWTVerifyGetKey => {
  let set = jwksCache.get(clientId);
  if (!set) {
    const url = new URL("/.well-known/jwks.json", clientOrigin(clientId));
    set = createRemoteJWKSet(url);
    jwksCache.set(clientId, set);
  }
  return set;
};
