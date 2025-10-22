import { fromArrayBuffer, toArrayBuffer } from "@hexagon/base64";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toUint8Array = (value: ArrayBuffer | Uint8Array): Uint8Array =>
  value instanceof Uint8Array ? value : new Uint8Array(value);

const toArrayBufferLike = (value: ArrayBuffer | Uint8Array): ArrayBuffer =>
  value instanceof Uint8Array
    ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
    : value;

export const encodeBase64 = (value: ArrayBuffer | Uint8Array): string =>
  fromArrayBuffer(toArrayBufferLike(value));

export const encodeBase64Url = (value: ArrayBuffer | Uint8Array): string =>
  fromArrayBuffer(toArrayBufferLike(value), true);

export const decodeBase64 = (value: string): Uint8Array =>
  new Uint8Array(toArrayBuffer(value));

export const decodeBase64Url = (value: string): Uint8Array =>
  new Uint8Array(toArrayBuffer(value, true));

export const encodeText = (value: string): Uint8Array =>
  textEncoder.encode(value);

export const decodeText = (value: ArrayBuffer | Uint8Array): string =>
  textDecoder.decode(toUint8Array(value));
