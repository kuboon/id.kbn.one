import { base64 } from "@hexagon/base64";

const SECRET_BYTE_LENGTH = 32;
const secret = new Uint8Array(SECRET_BYTE_LENGTH);
crypto.getRandomValues(secret);
const encoded = base64.fromArrayBuffer(secret.buffer, true);
console.log(`HMAC_KEY=${encoded}`);
