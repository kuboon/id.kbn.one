import { GenerateDpopKeyPairOptions, DpopJwtPayload, CreateDpopProofOptions } from "./types.ts";
import { base64UrlEncode, normalizeMethod, normalizeHtu, sha256Base64Url } from "./common.ts";

const textEncoder = new TextEncoder();

const stripPrivateFields = (jwk: JsonWebKey): JsonWebKey => {
  const { crv, kty, x, y } = jwk;
  return { crv, kty, x, y };
};

export const generateDpopKeyPair = (
  options: GenerateDpopKeyPairOptions = {},
): Promise<CryptoKeyPair> =>
  crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    options.extractable ?? true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;

export const createDpopProof = async (
  options: CreateDpopProofOptions,
): Promise<string> => {
  const method = normalizeMethod(options.method);
  const htu = normalizeHtu(options.url);
  const iat = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();

  if (!method) throw new TypeError("HTTP method is required to create a DPoP proof.");

  const payload: DpopJwtPayload = {
    htm: method,
    htu,
    iat,
    jti,
  };

  const publicJwk = await crypto.subtle.exportKey(
    "jwk",
    options.keyPair.publicKey,
  );

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
    options.keyPair.privateKey,
    textEncoder.encode(signingInput),
  );

  const encodedSignature = base64UrlEncode(signature);
  return `${signingInput}.${encodedSignature}`;
};
