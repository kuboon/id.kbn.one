import { DpopJwtPayload } from "./types.ts";
import { base64UrlEncode, normalizeMethod, normalizeHtu } from "./common.ts";
import type { KeyStore } from "./keystore.ts";

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

  if (!htm) throw new TypeError("HTTP method is required to create a DPoP proof.");

  const payload: DpopJwtPayload = { htm, htu, iat, jti };

  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const header = { alg: "ES256" as const, typ: "dpop+jwt" as const, jwk: stripPrivateFields(publicJwk) };

  const encodedHeader = base64UrlEncode(textEncoder.encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, textEncoder.encode(signingInput));
  const encodedSignature = base64UrlEncode(signature);
  return `${signingInput}.${encodedSignature}`;
};

export interface InitOptions {
  keyStore: KeyStore;
  fetch?: typeof fetch;
}

export const init = (opts: InitOptions) => {
  const useFetch = opts.fetch ?? fetch.bind(globalThis);

  const apiCall = async (input: RequestInfo, init?: RequestInit) => {
    const keyPair = await opts.keyStore.getKeyPair();
    if (!keyPair) throw new Error("DPoP key not found in KeyStore; generate and save a key pair before calling apiCall()");
    const method = (init && init.method) ?? (typeof input === "string" ? "GET" : (input as Request).method);
    const url = typeof input === "string" ? input : (input as Request).url;
    const proof = await createDpopProof(keyPair, method, url);

    const headers = new Headers(init?.headers ?? (typeof input === "string" ? undefined : (input as Request).headers));
    headers.set("DPoP", proof);

    const merged: RequestInit = { ...(init ?? {}), headers };
    return useFetch(input, merged);
  };

  return { apiCall };
};
