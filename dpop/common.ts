import { encodeBase64Url } from "@std/encoding/base64url";

export const toUint8Array = (input: ArrayBuffer | Uint8Array): Uint8Array =>
  input instanceof Uint8Array ? input : new Uint8Array(input);

export const base64UrlEncode = (input: ArrayBuffer | Uint8Array): string =>
  encodeBase64Url(toUint8Array(input));

export const normalizeMethod = (method: string): string => method.trim().toUpperCase();

export const normalizeHtu = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
};
