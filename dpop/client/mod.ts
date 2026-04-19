/**
 * Client-side DPoP helper. Generates (or reuses) an ECDSA P-256 key pair in a
 * pluggable key store and exposes a `fetch`-compatible wrapper that attaches a
 * fresh `DPoP` header to every request.
 *
 * @example
 * ```ts
 * import { init } from "@kuboon/dpop";
 *
 * const { fetchDpop, thumbprint } = await init();
 * // Share `thumbprint` with your IdP so it can bind sessions/tokens to this key.
 * await fetchDpop("/api/profile");
 * ```
 *
 * @module
 */
import type { DpopJwtPayload } from "../types.ts";
import {
  base64UrlEncode,
  computeThumbprint,
  normalizeHtu,
  normalizeMethod,
} from "../common.ts";
import {
  IndexedDbKeyRepository,
  type KeyRepository,
} from "./client_keystore.ts";

export {
  IndexedDbKeyRepository,
  InMemoryKeyRepository,
  type KeyRepository,
} from "./client_keystore.ts";

const textEncoder = new TextEncoder();

const stripPrivateFields = (jwk: JsonWebKey): JsonWebKey => {
  const { crv, kty, x, y } = jwk;
  return { crv, kty, x, y };
};

const createDpopProof = async (
  keyPair: CryptoKeyPair,
  method: string,
  url: string,
): Promise<string> => {
  const htm = normalizeMethod(method);
  const htu = normalizeHtu(url);
  const iat = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();

  if (!htm) {
    throw new TypeError("HTTP method is required to create a DPoP proof.");
  }

  const payload: DpopJwtPayload = { htm, htu, iat, jti };

  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const header = {
    alg: "ES256" as const,
    typ: "dpop+jwt" as const,
    jwk: stripPrivateFields(publicJwk),
  };

  const encodedHeader = base64UrlEncode(
    textEncoder.encode(JSON.stringify(header)),
  );
  const encodedPayload = base64UrlEncode(
    textEncoder.encode(JSON.stringify(payload)),
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    textEncoder.encode(signingInput),
  );
  const encodedSignature = base64UrlEncode(signature);
  return `${signingInput}.${encodedSignature}`;
};

type FetchLike = typeof fetch;

/** Options for {@link init}. */
export interface InitOptions {
  /**
   * Where the long-lived key pair lives. Defaults to
   * {@link IndexedDbKeyRepository} — browser only.
   *
   * On non-browser targets or in tests, pass an explicit store such as
   * `InMemoryKeyRepository` or your own `KeyRepository` implementation.
   */
  keyStore?: KeyRepository;
  /**
   * Override the underlying `fetch` implementation. Useful for tests and for
   * environments that don't expose a global `fetch`. Defaults to
   * `globalThis.fetch` bound to `globalThis`.
   */
  fetch?: FetchLike;
}

function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
}
function getMethodUrl(
  input: RequestInfo | URL,
  init?: RequestInit,
): { method: string; url: string } {
  const method = (init && init.method) ??
    (input instanceof Request ? input.method : "GET");
  if (typeof input === "string") {
    if (input.includes("://")) {
      return { method, url: input };
    }
    const origin = globalThis.location?.origin ?? "http://test.localhost";
    return { method, url: origin + input };
  }
  const url = input instanceof URL ? input.toString() : input.url;
  return { method, url };
}
/**
 * Bootstrap a DPoP-enabled fetch for the current context.
 *
 * The returned `fetchDpop` has the same signature as `fetch`. On each call it
 * builds a fresh DPoP proof for that request's method and URL, signs it with
 * the stored key, and sets the `DPoP` header. Other headers on the input are
 * preserved.
 *
 * `thumbprint` is the RFC 7638 JWK SHA-256 thumbprint of the public key — the
 * value a DPoP-aware IdP expects as `dpop_jkt` / the token's `cnf.jkt`.
 *
 * @returns `fetchDpop` (the wrapped fetch), plus the public `thumbprint` and
 *   `publicJwk` you may want to hand to your authorization server.
 */
export async function init(
  opts: InitOptions = {},
): Promise<
  { fetchDpop: FetchLike; thumbprint: string; publicJwk: JsonWebKey }
> {
  opts.keyStore ??= new IndexedDbKeyRepository();
  const useFetch = opts.fetch ?? fetch.bind(globalThis);

  let keyPair_ = await opts.keyStore.getKeyPair();
  if (!keyPair_) {
    keyPair_ = await generateKeyPair();
    await opts.keyStore.saveKeyPair(keyPair_);
  }
  const keyPair = keyPair_;

  const publicJwk = stripPrivateFields(
    await crypto.subtle.exportKey("jwk", keyPair.publicKey),
  );
  const thumbprint = await computeThumbprint(publicJwk);

  const fetchDpop: FetchLike = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const { method, url } = getMethodUrl(input, init);
    const proof = await createDpopProof(
      keyPair,
      method,
      url,
    );

    const headers = new Headers(
      init?.headers ??
        (typeof input === "string" ? undefined : (input as Request).headers),
    );
    headers.set("DPoP", proof);

    const merged: RequestInit = { ...(init ?? {}), headers };
    return useFetch(input, merged);
  };

  return { fetchDpop, thumbprint, publicJwk };
}
