/**
 * The IdP's persistent ECDSA P-256 signing key.
 *
 * The same key is used for VAPID (RFC 8292) push notifications and for JWS
 * (RFC 7515 / RFC 7519) signatures. Stored as a JWK pair under the
 * `signing_key` secret slot and generated on first use.
 */

import { calculateJwkThumbprint } from "jose";
import { encodeBase64Url } from "@std/encoding/base64url";

import { Secret } from "../secret.ts";

const algo = { name: "ECDSA", namedCurve: "P-256" } as const;

interface StoredJwkPair {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

/** A JWK extended with the JWS metadata fields (RFC 7517 §4). */
export type PublicJwk = JsonWebKey & {
  kid: string;
  use: "sig";
  alg: "ES256";
};

export interface SigningKey {
  /** ECDSA P-256 key pair. */
  readonly keyPair: CryptoKeyPair;
  /** Raw base64url-encoded public key — the VAPID application server key. */
  readonly publicKey: string;
  /** RFC 7638 JWK SHA-256 thumbprint of the public key, used as `kid`. */
  readonly kid: string;
  /** Public JWK with `kid`/`use`/`alg` populated, ready to embed in JWKS. */
  readonly publicJwk: PublicJwk;
}

let signingKeyPromise: Promise<SigningKey> | undefined;

/**
 * Load (or generate-on-first-use) the IdP's signing key. Idempotent;
 * subsequent callers receive the cached value.
 */
export const getSigningKey = (): Promise<SigningKey> => {
  if (!signingKeyPromise) {
    signingKeyPromise = (async () => {
      const slot = await Secret<StoredJwkPair>("signing_key", async () => {
        const pair = await crypto.subtle.generateKey(algo, true, [
          "sign",
          "verify",
        ]);
        return {
          publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
          privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
        };
      });
      const stored = await slot.get();
      const [publicCryptoKey, privateCryptoKey] = await Promise.all([
        crypto.subtle.importKey("jwk", stored.publicKey, algo, true, [
          "verify",
        ]),
        crypto.subtle.importKey("jwk", stored.privateKey, algo, false, [
          "sign",
        ]),
      ]);
      const rawPublic = await crypto.subtle.exportKey("raw", publicCryptoKey);
      const kid = await calculateJwkThumbprint(stored.publicKey);
      const { kty, crv, x, y } = stored.publicKey;
      const publicJwk: PublicJwk = {
        kty,
        crv,
        x,
        y,
        kid,
        use: "sig",
        alg: "ES256",
      };
      return {
        keyPair: { publicKey: publicCryptoKey, privateKey: privateCryptoKey },
        publicKey: encodeBase64Url(new Uint8Array(rawPublic)),
        kid,
        publicJwk,
      };
    })();
  }
  return signingKeyPromise;
};
