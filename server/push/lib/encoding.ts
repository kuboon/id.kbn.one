const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toUint8Array = (value: ArrayBuffer | Uint8Array): Uint8Array =>
  value instanceof Uint8Array ? value : new Uint8Array(value);

export const encodeBase64 = (value: ArrayBuffer | Uint8Array): string => {
  const bytes = toUint8Array(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const encodeBase64Url = (value: ArrayBuffer | Uint8Array): string =>
  encodeBase64(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

const normalizeBase64Input = (input: string): string => {
  const padded = input.replaceAll("-", "+").replaceAll("_", "/");
  const paddingLength = (4 - (padded.length % 4)) % 4;
  return padded.padEnd(padded.length + paddingLength, "=");
};

const decodeBase64String = (value: string): Uint8Array => {
  const normalized = normalizeBase64Input(value);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const decodeBase64 = (value: string): Uint8Array =>
  decodeBase64String(value);

export const decodeBase64Url = (value: string): Uint8Array =>
  decodeBase64String(value);

export const encodeText = (value: string): Uint8Array =>
  textEncoder.encode(value);

export const decodeText = (value: ArrayBuffer | Uint8Array): string =>
  textDecoder.decode(toUint8Array(value));
