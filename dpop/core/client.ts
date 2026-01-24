import type { DpopJwtPayload } from "./types.ts";
import { base64UrlEncode, normalizeHtu, normalizeMethod } from "./common.ts";
import {
  IndexedDbKeyRepository,
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

export interface InitOptions {
  keyStore?: KeyRepository;
  fetch?: typeof fetch;
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
export const init = async (opts: InitOptions = {}) => {
  opts.keyStore ??= new IndexedDbKeyRepository();
  const useFetch = opts.fetch ?? fetch.bind(globalThis);

  let keyPair_ = await opts.keyStore.getKeyPair();
  if (!keyPair_) {
    keyPair_ = await generateKeyPair();
    await opts.keyStore.saveKeyPair(keyPair_);
  }
  const keyPair = keyPair_;
  const fetchDpop: typeof fetch = async (
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

  return { fetchDpop };
};
