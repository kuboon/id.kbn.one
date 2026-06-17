/**
 * Registry of RP (relying party) servers allowed to authenticate to the IdP
 * with a `private_key_jwt` client assertion (RFC 7521 / RFC 7523).
 *
 * Each client registers one or more **public** EC P-256 JWKs. The IdP never
 * holds a shared secret — it only verifies signatures made by the RP's
 * private key, so a leaked registry exposes nothing sensitive and each RP can
 * rotate keys independently (list the new key alongside the old during a
 * rollover).
 *
 * Configured via the `RP_PUSH_CLIENTS` env var as a JSON array:
 *
 * ```json
 * [
 *   {
 *     "clientId": "rp.example.com",
 *     "keys": [
 *       { "kty": "EC", "crv": "P-256", "x": "…", "y": "…",
 *         "alg": "ES256", "kid": "…" }
 *     ]
 *   }
 * ]
 * ```
 *
 * A single key may also be given as `"jwk": { … }` instead of `"keys": [ … ]`.
 */

import { createLocalJWKSet, type JWTVerifyGetKey } from "jose";

export interface RpClient {
  readonly clientId: string;
  /** jose key resolver over the client's registered public JWK(s). */
  readonly keys: JWTVerifyGetKey;
}

export interface RpClientRegistry {
  get(clientId: string): RpClient | undefined;
  readonly size: number;
}

interface RawClientEntry {
  clientId?: unknown;
  keys?: unknown;
  jwk?: unknown;
}

const isJwk = (value: unknown): value is JsonWebKey =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Build a registry from a parsed JSON value. Throws `TypeError` on malformed
 * input so misconfiguration fails loudly at startup rather than silently
 * rejecting every RP at request time.
 */
export const buildRpClientRegistry = (input: unknown): RpClientRegistry => {
  const clients = new Map<string, RpClient>();
  if (input === undefined || input === null) {
    return { get: (id) => clients.get(id), size: 0 };
  }
  if (!Array.isArray(input)) {
    throw new TypeError("RP_PUSH_CLIENTS must be a JSON array");
  }

  for (const raw of input as RawClientEntry[]) {
    const clientId = raw?.clientId;
    if (typeof clientId !== "string" || !clientId.trim()) {
      throw new TypeError("RP client entry is missing a string clientId");
    }
    const keys: JsonWebKey[] = Array.isArray(raw.keys)
      ? raw.keys.filter(isJwk)
      : isJwk(raw.jwk)
      ? [raw.jwk]
      : [];
    if (!keys.length) {
      throw new TypeError(`RP client "${clientId}" has no public keys`);
    }
    clients.set(clientId, {
      clientId,
      keys: createLocalJWKSet({ keys }),
    });
  }

  return { get: (id) => clients.get(id), size: clients.size };
};

let cached: RpClientRegistry | undefined;

/** Lazily parse `RP_PUSH_CLIENTS` once and cache the resulting registry. */
export const rpClientRegistry = (): RpClientRegistry => {
  if (!cached) {
    const json = Deno.env.get("RP_PUSH_CLIENTS")?.trim();
    cached = buildRpClientRegistry(json ? JSON.parse(json) : undefined);
  }
  return cached;
};
