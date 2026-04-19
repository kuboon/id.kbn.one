import { base64 } from "@hexagon/base64";

const encodeBase64Url = (input: ArrayBuffer) =>
  base64.fromArrayBuffer(input, true);
const decodeBase64Url = (input: string) =>
  new Uint8Array(base64.toArrayBuffer(input, true));

export type SecretProvider = () => Promise<string>;

export interface TokenPayload {
  userId?: string;
  challenge?: string;
  origin?: string;
  type?: string;
  exp?: number;
  authenticated?: boolean;
  // allow extra fields when needed
  [key: string]: unknown;
}

export function createHmacHelpers(getSecret: SecretProvider) {
  const signToken = async (obj: TokenPayload) => {
    const secretB64 = await getSecret();
    const secret = new Uint8Array(base64.toArrayBuffer(secretB64, true));
    const payload = new TextEncoder().encode(JSON.stringify(obj));
    const key = await crypto.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload));
    const payloadB64 = encodeBase64Url(payload.buffer);
    const sigB64 = encodeBase64Url(sig.buffer);
    return `${payloadB64}.${sigB64}`;
  };

  const verifyToken = async (token: string) => {
    const parts = (token || "").split(".");
    if (parts.length !== 2) throw new Error("Invalid token");
    const [payloadB64, sigB64] = parts;
    const payload = decodeBase64Url(payloadB64);
    const sig = decodeBase64Url(sigB64);
    const secretB64 = await getSecret();
    const secret = new Uint8Array(base64.toArrayBuffer(secretB64, true));
    const key = await crypto.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, payload),
    );
    if (sig.length !== expected.length) throw new Error("Invalid signature");
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig[i] ^ expected[i];
    if (diff !== 0) throw new Error("Invalid signature");
    const decoded = new TextDecoder().decode(payload);
    const parsed = JSON.parse(decoded) as TokenPayload;
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = parsed.exp as unknown as number | undefined;
    if (typeof exp === "number" && nowSec > exp) {
      throw new Error("Token expired");
    }
    return parsed;
  };

  return { signToken, verifyToken };
}

export default createHmacHelpers;
