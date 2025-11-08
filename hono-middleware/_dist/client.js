// ../node_modules/.deno/@simplewebauthn+browser@13.2.2/node_modules/@simplewebauthn/browser/esm/helpers/bufferToBase64URLString.js
function bufferToBase64URLString(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const charCode of bytes) {
    str += String.fromCharCode(charCode);
  }
  const base64String = btoa(str);
  return base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ../node_modules/.deno/@simplewebauthn+browser@13.2.2/node_modules/@simplewebauthn/browser/esm/helpers/base64URLStringToBuffer.js
function base64URLStringToBuffer(base64URLString) {
  const base64 = base64URLString.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - base64.length % 4) % 4;
  const padded = base64.padEnd(base64.length + padLength, "=");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

// ../node_modules/.deno/@simplewebauthn+browser@13.2.2/node_modules/@simplewebauthn/browser/esm/helpers/browserSupportsWebAuthn.js
function browserSupportsWebAuthn() {
  return _browserSupportsWebAuthnInternals.stubThis(globalThis?.PublicKeyCredential !== void 0 && typeof globalThis.PublicKeyCredential === "function");
}
var _browserSupportsWebAuthnInternals = {
  stubThis: (value) => value
};

// ../node_modules/.deno/@simplewebauthn+browser@13.2.2/node_modules/@simplewebauthn/browser/esm/helpers/toPublicKeyCredentialDescriptor.js
function toPublicKeyCredentialDescriptor(descriptor) {
  const { id } = descriptor;
  return {
    ...descriptor,
    id: base64URLStringToBuffer(id),
    /**
         * `descriptor.transports` is an array of our `AuthenticatorTransportFuture` that includes newer
         * transports that TypeScript's DOM lib is ignorant of. Convince TS that our list of transports
         * are fine to pass to WebAuthn since browsers will recognize the new value.
         */
    transports: descriptor.transports
  };
}

// ../node_modules/.deno/@simplewebauthn+browser@13.2.2/node_modules/@simplewebauthn/browser/esm/helpers/isValidDomain.js
function isValidDomain(hostname) {
  return (
    // Consider localhost valid as well since it's okay wrt Secure Contexts
    hostname === "localhost" || /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i.test(hostname)
  );
}

// ../node_modules/.deno/@simplewebauthn+browser@13.2.2/node_modules/@simplewebauthn/browser/esm/helpers/webAuthnError.js
var WebAuthnError = class extends Error {
  constructor({ message, code, cause, name }) {
    super(message, {
      cause
    });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.name = name ?? cause.name;
    this.code = code;
  }
};

// ../node_modules/.deno/@simplewebauthn+browser@13.2.2/node_modules/@simplewebauthn/browser/esm/helpers/identifyRegistrationError.js
function identifyRegistrationError({ error, options }) {
  const { publicKey } = options;
  if (!publicKey) {
    throw Error("options was missing required publicKey property");
  }
  if (error.name === "AbortError") {
    if (options.signal instanceof AbortSignal) {
      return new WebAuthnError({
        message: "Registration ceremony was sent an abort signal",
        code: "ERROR_CEREMONY_ABORTED",
        cause: error
      });
    }
  } else if (error.name === "ConstraintError") {
    if (publicKey.authenticatorSelection?.requireResidentKey === true) {
      return new WebAuthnError({
        message: "Discoverable credentials were required but no available authenticator supported it",
        code: "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT",
        cause: error
      });
    } else if (
      // @ts-ignore: `mediation` doesn't yet exist on CredentialCreationOptions but it's possible as of Sept 2024
      options.mediation === "conditional" && publicKey.authenticatorSelection?.userVerification === "required"
    ) {
      return new WebAuthnError({
        message: "User verification was required during automatic registration but it could not be performed",
        code: "ERROR_AUTO_REGISTER_USER_VERIFICATION_FAILURE",
        cause: error
      });
    } else if (publicKey.authenticatorSelection?.userVerification === "required") {
      return new WebAuthnError({
        message: "User verification was required but no available authenticator supported it",
        code: "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT",
        cause: error
      });
    }
  } else if (error.name === "InvalidStateError") {
    return new WebAuthnError({
      message: "The authenticator was previously registered",
      code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
      cause: error
    });
  } else if (error.name === "NotAllowedError") {
    return new WebAuthnError({
      message: error.message,
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause: error
    });
  } else if (error.name === "NotSupportedError") {
    const validPubKeyCredParams = publicKey.pubKeyCredParams.filter((param) => param.type === "public-key");
    if (validPubKeyCredParams.length === 0) {
      return new WebAuthnError({
        message: 'No entry in pubKeyCredParams was of type "public-key"',
        code: "ERROR_MALFORMED_PUBKEYCREDPARAMS",
        cause: error
      });
    }
    return new WebAuthnError({
      message: "No available authenticator supported any of the specified pubKeyCredParams algorithms",
      code: "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG",
      cause: error
    });
  } else if (error.name === "SecurityError") {
    const effectiveDomain = globalThis.location.hostname;
    if (!isValidDomain(effectiveDomain)) {
      return new WebAuthnError({
        message: `${globalThis.location.hostname} is an invalid domain`,
        code: "ERROR_INVALID_DOMAIN",
        cause: error
      });
    } else if (publicKey.rp.id !== effectiveDomain) {
      return new WebAuthnError({
        message: `The RP ID "${publicKey.rp.id}" is invalid for this domain`,
        code: "ERROR_INVALID_RP_ID",
        cause: error
      });
    }
  } else if (error.name === "TypeError") {
    if (publicKey.user.id.byteLength < 1 || publicKey.user.id.byteLength > 64) {
      return new WebAuthnError({
        message: "User ID was not between 1 and 64 characters",
        code: "ERROR_INVALID_USER_ID_LENGTH",
        cause: error
      });
    }
  } else if (error.name === "UnknownError") {
    return new WebAuthnError({
      message: "The authenticator was unable to process the specified options, or could not create a new credential",
      code: "ERROR_AUTHENTICATOR_GENERAL_ERROR",
      cause: error
    });
  }
  return error;
}

// ../node_modules/.deno/@simplewebauthn+browser@13.2.2/node_modules/@simplewebauthn/browser/esm/helpers/webAuthnAbortService.js
var BaseWebAuthnAbortService = class {
  constructor() {
    Object.defineProperty(this, "controller", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
  }
  createNewAbortSignal() {
    if (this.controller) {
      const abortError = new Error("Cancelling existing WebAuthn API call for new one");
      abortError.name = "AbortError";
      this.controller.abort(abortError);
    }
    const newController = new AbortController();
    this.controller = newController;
    return newController.signal;
  }
  cancelCeremony() {
    if (this.controller) {
      const abortError = new Error("Manually cancelling existing WebAuthn API call");
      abortError.name = "AbortError";
      this.controller.abort(abortError);
      this.controller = void 0;
    }
  }
};
var WebAuthnAbortService = new BaseWebAuthnAbortService();

// ../node_modules/.deno/@simplewebauthn+browser@13.2.2/node_modules/@simplewebauthn/browser/esm/helpers/toAuthenticatorAttachment.js
var attachments = [
  "cross-platform",
  "platform"
];
function toAuthenticatorAttachment(attachment) {
  if (!attachment) {
    return;
  }
  if (attachments.indexOf(attachment) < 0) {
    return;
  }
  return attachment;
}

// ../node_modules/.deno/@simplewebauthn+browser@13.2.2/node_modules/@simplewebauthn/browser/esm/methods/startRegistration.js
async function startRegistration(options) {
  if (!options.optionsJSON && options.challenge) {
    console.warn("startRegistration() was not called correctly. It will try to continue with the provided options, but this call should be refactored to use the expected call structure instead. See https://simplewebauthn.dev/docs/packages/browser#typeerror-cannot-read-properties-of-undefined-reading-challenge for more information.");
    options = {
      optionsJSON: options
    };
  }
  const { optionsJSON, useAutoRegister = false } = options;
  if (!browserSupportsWebAuthn()) {
    throw new Error("WebAuthn is not supported in this browser");
  }
  const publicKey = {
    ...optionsJSON,
    challenge: base64URLStringToBuffer(optionsJSON.challenge),
    user: {
      ...optionsJSON.user,
      id: base64URLStringToBuffer(optionsJSON.user.id)
    },
    excludeCredentials: optionsJSON.excludeCredentials?.map(toPublicKeyCredentialDescriptor)
  };
  const createOptions = {};
  if (useAutoRegister) {
    createOptions.mediation = "conditional";
  }
  createOptions.publicKey = publicKey;
  createOptions.signal = WebAuthnAbortService.createNewAbortSignal();
  let credential;
  try {
    credential = await navigator.credentials.create(createOptions);
  } catch (err) {
    throw identifyRegistrationError({
      error: err,
      options: createOptions
    });
  }
  if (!credential) {
    throw new Error("Registration was not completed");
  }
  const { id, rawId, response, type } = credential;
  let transports = void 0;
  if (typeof response.getTransports === "function") {
    transports = response.getTransports();
  }
  let responsePublicKeyAlgorithm = void 0;
  if (typeof response.getPublicKeyAlgorithm === "function") {
    try {
      responsePublicKeyAlgorithm = response.getPublicKeyAlgorithm();
    } catch (error) {
      warnOnBrokenImplementation("getPublicKeyAlgorithm()", error);
    }
  }
  let responsePublicKey = void 0;
  if (typeof response.getPublicKey === "function") {
    try {
      const _publicKey = response.getPublicKey();
      if (_publicKey !== null) {
        responsePublicKey = bufferToBase64URLString(_publicKey);
      }
    } catch (error) {
      warnOnBrokenImplementation("getPublicKey()", error);
    }
  }
  let responseAuthenticatorData;
  if (typeof response.getAuthenticatorData === "function") {
    try {
      responseAuthenticatorData = bufferToBase64URLString(response.getAuthenticatorData());
    } catch (error) {
      warnOnBrokenImplementation("getAuthenticatorData()", error);
    }
  }
  return {
    id,
    rawId: bufferToBase64URLString(rawId),
    response: {
      attestationObject: bufferToBase64URLString(response.attestationObject),
      clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
      transports,
      publicKeyAlgorithm: responsePublicKeyAlgorithm,
      publicKey: responsePublicKey,
      authenticatorData: responseAuthenticatorData
    },
    type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: toAuthenticatorAttachment(credential.authenticatorAttachment)
  };
}
function warnOnBrokenImplementation(methodName, cause) {
  console.warn(`The browser extension that intercepted this WebAuthn API call incorrectly implemented ${methodName}. You should report this error to them.
`, cause);
}

// ../node_modules/.deno/@simplewebauthn+browser@13.2.2/node_modules/@simplewebauthn/browser/esm/helpers/browserSupportsWebAuthnAutofill.js
function browserSupportsWebAuthnAutofill() {
  if (!browserSupportsWebAuthn()) {
    return _browserSupportsWebAuthnAutofillInternals.stubThis(new Promise((resolve) => resolve(false)));
  }
  const globalPublicKeyCredential = globalThis.PublicKeyCredential;
  if (globalPublicKeyCredential?.isConditionalMediationAvailable === void 0) {
    return _browserSupportsWebAuthnAutofillInternals.stubThis(new Promise((resolve) => resolve(false)));
  }
  return _browserSupportsWebAuthnAutofillInternals.stubThis(globalPublicKeyCredential.isConditionalMediationAvailable());
}
var _browserSupportsWebAuthnAutofillInternals = {
  stubThis: (value) => value
};

// ../node_modules/.deno/@simplewebauthn+browser@13.2.2/node_modules/@simplewebauthn/browser/esm/helpers/identifyAuthenticationError.js
function identifyAuthenticationError({ error, options }) {
  const { publicKey } = options;
  if (!publicKey) {
    throw Error("options was missing required publicKey property");
  }
  if (error.name === "AbortError") {
    if (options.signal instanceof AbortSignal) {
      return new WebAuthnError({
        message: "Authentication ceremony was sent an abort signal",
        code: "ERROR_CEREMONY_ABORTED",
        cause: error
      });
    }
  } else if (error.name === "NotAllowedError") {
    return new WebAuthnError({
      message: error.message,
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause: error
    });
  } else if (error.name === "SecurityError") {
    const effectiveDomain = globalThis.location.hostname;
    if (!isValidDomain(effectiveDomain)) {
      return new WebAuthnError({
        message: `${globalThis.location.hostname} is an invalid domain`,
        code: "ERROR_INVALID_DOMAIN",
        cause: error
      });
    } else if (publicKey.rpId !== effectiveDomain) {
      return new WebAuthnError({
        message: `The RP ID "${publicKey.rpId}" is invalid for this domain`,
        code: "ERROR_INVALID_RP_ID",
        cause: error
      });
    }
  } else if (error.name === "UnknownError") {
    return new WebAuthnError({
      message: "The authenticator was unable to process the specified options, or could not create a new assertion signature",
      code: "ERROR_AUTHENTICATOR_GENERAL_ERROR",
      cause: error
    });
  }
  return error;
}

// ../node_modules/.deno/@simplewebauthn+browser@13.2.2/node_modules/@simplewebauthn/browser/esm/methods/startAuthentication.js
async function startAuthentication(options) {
  if (!options.optionsJSON && options.challenge) {
    console.warn("startAuthentication() was not called correctly. It will try to continue with the provided options, but this call should be refactored to use the expected call structure instead. See https://simplewebauthn.dev/docs/packages/browser#typeerror-cannot-read-properties-of-undefined-reading-challenge for more information.");
    options = {
      optionsJSON: options
    };
  }
  const { optionsJSON, useBrowserAutofill = false, verifyBrowserAutofillInput = true } = options;
  if (!browserSupportsWebAuthn()) {
    throw new Error("WebAuthn is not supported in this browser");
  }
  let allowCredentials;
  if (optionsJSON.allowCredentials?.length !== 0) {
    allowCredentials = optionsJSON.allowCredentials?.map(toPublicKeyCredentialDescriptor);
  }
  const publicKey = {
    ...optionsJSON,
    challenge: base64URLStringToBuffer(optionsJSON.challenge),
    allowCredentials
  };
  const getOptions = {};
  if (useBrowserAutofill) {
    if (!await browserSupportsWebAuthnAutofill()) {
      throw Error("Browser does not support WebAuthn autofill");
    }
    const eligibleInputs = document.querySelectorAll("input[autocomplete$='webauthn']");
    if (eligibleInputs.length < 1 && verifyBrowserAutofillInput) {
      throw Error('No <input> with "webauthn" as the only or last value in its `autocomplete` attribute was detected');
    }
    getOptions.mediation = "conditional";
    publicKey.allowCredentials = [];
  }
  getOptions.publicKey = publicKey;
  getOptions.signal = WebAuthnAbortService.createNewAbortSignal();
  let credential;
  try {
    credential = await navigator.credentials.get(getOptions);
  } catch (err) {
    throw identifyAuthenticationError({
      error: err,
      options: getOptions
    });
  }
  if (!credential) {
    throw new Error("Authentication was not completed");
  }
  const { id, rawId, response, type } = credential;
  let userHandle = void 0;
  if (response.userHandle) {
    userHandle = bufferToBase64URLString(response.userHandle);
  }
  return {
    id,
    rawId: bufferToBase64URLString(rawId),
    response: {
      authenticatorData: bufferToBase64URLString(response.authenticatorData),
      clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
      signature: bufferToBase64URLString(response.signature),
      userHandle
    },
    type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: toAuthenticatorAttachment(credential.authenticatorAttachment)
  };
}

// ../node_modules/.deno/@simplewebauthn+browser@13.2.2/node_modules/@simplewebauthn/browser/esm/helpers/platformAuthenticatorIsAvailable.js
function platformAuthenticatorIsAvailable() {
  if (!browserSupportsWebAuthn()) {
    return new Promise((resolve) => resolve(false));
  }
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}

// deno:https://jsr.io/@std/encoding/1.0.10/_common64.ts
var padding = "=".charCodeAt(0);
var alphabet = {
  base64: new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"),
  base64url: new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
};
var rAlphabet = {
  base64: new Uint8Array(128).fill(64),
  base64url: new Uint8Array(128).fill(64)
};
alphabet.base64.forEach((byte, i) => rAlphabet.base64[byte] = i);
alphabet.base64url.forEach((byte, i) => rAlphabet.base64url[byte] = i);
function calcSizeBase64(originalSize) {
  return ((originalSize + 2) / 3 | 0) * 4;
}
function encode(buffer, i, o, alphabet3, padding3) {
  i += 2;
  for (; i < buffer.length; i += 3) {
    const x = buffer[i - 2] << 16 | buffer[i - 1] << 8 | buffer[i];
    buffer[o++] = alphabet3[x >> 18];
    buffer[o++] = alphabet3[x >> 12 & 63];
    buffer[o++] = alphabet3[x >> 6 & 63];
    buffer[o++] = alphabet3[x & 63];
  }
  switch (i) {
    case buffer.length + 1: {
      const x = buffer[i - 2] << 16;
      buffer[o++] = alphabet3[x >> 18];
      buffer[o++] = alphabet3[x >> 12 & 63];
      buffer[o++] = padding3;
      buffer[o++] = padding3;
      break;
    }
    case buffer.length: {
      const x = buffer[i - 2] << 16 | buffer[i - 1] << 8;
      buffer[o++] = alphabet3[x >> 18];
      buffer[o++] = alphabet3[x >> 12 & 63];
      buffer[o++] = alphabet3[x >> 6 & 63];
      buffer[o++] = padding3;
      break;
    }
  }
  return o;
}

// deno:https://jsr.io/@std/encoding/1.0.10/_common_detach.ts
function detach(buffer, maxSize) {
  const originalSize = buffer.length;
  if (buffer.byteOffset) {
    const b = new Uint8Array(buffer.buffer);
    b.set(buffer);
    buffer = b.subarray(0, originalSize);
  }
  buffer = new Uint8Array(buffer.buffer.transfer(maxSize));
  buffer.set(buffer.subarray(0, originalSize), maxSize - originalSize);
  return [
    buffer,
    maxSize - originalSize
  ];
}

// deno:https://jsr.io/@std/encoding/1.0.10/base64url.ts
var padding2 = "=".charCodeAt(0);
var alphabet2 = new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_");
var rAlphabet2 = new Uint8Array(128).fill(64);
alphabet2.forEach((byte, i) => rAlphabet2[byte] = i);
function encodeBase64Url(data) {
  if (typeof data === "string") {
    data = new TextEncoder().encode(data);
  } else if (data instanceof ArrayBuffer) data = new Uint8Array(data).slice();
  else data = data.slice();
  const [output, i] = detach(data, calcSizeBase64(data.length));
  let o = encode(output, i, 0, alphabet2, padding2);
  o = output.indexOf(padding2, o - 2);
  return new TextDecoder().decode(o > 0 ? new Uint8Array(output.buffer.transfer(o)) : output);
}

// ../dpop/mod.ts
var textEncoder = new TextEncoder();
var textDecoder = new TextDecoder();
var toUint8Array = (input) => input instanceof Uint8Array ? input : new Uint8Array(input);
var base64UrlEncode = (input) => encodeBase64Url(toUint8Array(input));
var sha256Base64Url = async (value) => {
  const data = textEncoder.encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
};
var normalizeMethod = (method) => method.trim().toUpperCase();
var normalizeHtu = (url) => {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
};
var generateDpopKeyPair = (options = {}) => crypto.subtle.generateKey({
  name: "ECDSA",
  namedCurve: "P-256"
}, options.extractable ?? true, [
  "sign",
  "verify"
]);
var stripPrivateFields = (jwk) => {
  const { crv, kty, x, y } = jwk;
  return {
    crv,
    kty,
    x,
    y
  };
};
var createDpopProof = async (options) => {
  const method = normalizeMethod(options.method);
  const htu = normalizeHtu(options.url);
  const iat = options.iat ?? Math.floor(Date.now() / 1e3);
  const jti = options.jti ?? crypto.randomUUID();
  if (!method) {
    throw new TypeError("HTTP method is required to create a DPoP proof.");
  }
  const payload = {
    htm: method,
    htu,
    iat,
    jti,
    ...options.nonce !== void 0 ? {
      nonce: options.nonce
    } : {},
    ...options.accessToken ? {
      ath: await sha256Base64Url(options.accessToken)
    } : {}
  };
  const publicJwk = await crypto.subtle.exportKey("jwk", options.keyPair.publicKey);
  const header = {
    alg: "ES256",
    typ: "dpop+jwt",
    jwk: stripPrivateFields(publicJwk)
  };
  const encodedHeader = base64UrlEncode(textEncoder.encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign({
    name: "ECDSA",
    hash: "SHA-256"
  }, options.keyPair.privateKey, textEncoder.encode(signingInput));
  const encodedSignature = base64UrlEncode(signature);
  return `${signingInput}.${encodedSignature}`;
};

// src/client.ts
var DEFAULT_MOUNT_PATH = "/webauthn";
var PASSKEY_ORIGIN = null;
var normalizeMountPath = (path) => {
  if (!path || path === "/") {
    return "";
  }
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
};
var hasJsonContentType = (response) => {
  const contentType = response.headers.get("content-type");
  return Boolean(contentType && contentType.toLowerCase().includes("json"));
};
var getErrorMessage = (data, fallback) => {
  if (typeof data === "string" && data.trim()) {
    return data;
  }
  if (data && typeof data === "object" && "message" in data) {
    const message = data.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
};
var PasskeyClientError = class extends Error {
  status;
  details;
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
};
var buildUrl = (mountPath, endpoint) => {
  const path = `${mountPath}${endpoint}`;
  if (!PASSKEY_ORIGIN) return path;
  return new URL(path, PASSKEY_ORIGIN).toString();
};
var fetchJson = async (fetchImpl, input, init) => {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetchImpl(input, {
    credentials: "include",
    ...init,
    headers
  });
  if (!response.ok) {
    let details = null;
    try {
      if (hasJsonContentType(response)) {
        details = await response.clone().json();
      } else {
        const text2 = await response.clone().text();
        details = text2.trim() ? text2 : null;
      }
    } catch {
      details = null;
    }
    const message = getErrorMessage(details, response.statusText || `Request failed with status ${response.status}`);
    throw new PasskeyClientError(message, response.status, details);
  }
  if (response.status === 204) {
    return null;
  }
  if (hasJsonContentType(response)) {
    return response.json();
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};
var createClient = (options = {}) => {
  const mountPath = normalizeMountPath(options.mountPath ?? DEFAULT_MOUNT_PATH);
  const fetchImpl = options.fetch ?? fetch;
  let dpopKeyPair = options.dpopKeyPair;
  const enableDpop = options.enableDpop ?? false;
  const ensureUsername = (username) => username.trim();
  const createDpopProofIfEnabled = async (method, url) => {
    if (!enableDpop || !dpopKeyPair) {
      return void 0;
    }
    try {
      return await createDpopProof({
        keyPair: dpopKeyPair,
        method,
        url
      });
    } catch (error) {
      console.error("Failed to create DPoP proof:", error);
      return void 0;
    }
  };
  return {
    async initDpop() {
      if (enableDpop && !dpopKeyPair) {
        dpopKeyPair = await generateDpopKeyPair();
      }
    },
    getDpopKeyPair() {
      return dpopKeyPair;
    },
    async register(params) {
      const username = ensureUsername(params.username);
      const optionsJSON = await fetchJson(fetchImpl, buildUrl(mountPath, "/register/options"), {
        method: "POST",
        body: JSON.stringify({
          username
        })
      });
      const attestationResponse = await startRegistration({
        optionsJSON
      });
      const verifyUrl = buildUrl(mountPath, "/register/verify");
      const dpopProof = await createDpopProofIfEnabled("POST", verifyUrl);
      const verification = await fetchJson(fetchImpl, verifyUrl, {
        method: "POST",
        body: JSON.stringify({
          username,
          credential: attestationResponse,
          ...dpopProof ? {
            dpopProof
          } : {}
        }),
        headers: dpopProof ? {
          DPoP: dpopProof
        } : void 0
      });
      return verification;
    },
    async authenticate(params) {
      const username = ensureUsername(params.username);
      const optionsJSON = await fetchJson(fetchImpl, buildUrl(mountPath, "/authenticate/options"), {
        method: "POST",
        body: JSON.stringify({
          username
        })
      });
      const assertionResponse = await startAuthentication({
        optionsJSON
      });
      const verifyUrl = buildUrl(mountPath, "/authenticate/verify");
      const dpopProof = await createDpopProofIfEnabled("POST", verifyUrl);
      const verification = await fetchJson(fetchImpl, verifyUrl, {
        method: "POST",
        body: JSON.stringify({
          username,
          credential: assertionResponse,
          ...dpopProof ? {
            dpopProof
          } : {}
        }),
        headers: dpopProof ? {
          DPoP: dpopProof
        } : void 0
      });
      return verification;
    },
    async list() {
      const url = buildUrl(mountPath, "/credentials");
      const response = await fetchJson(fetchImpl, url);
      const credentials = response && typeof response === "object" && "credentials" in response ? response.credentials ?? [] : [];
      return Array.isArray(credentials) ? credentials : [];
    },
    async delete(params) {
      const credentialId = params.credentialId;
      const url = buildUrl(mountPath, `/credentials/${encodeURIComponent(credentialId)}`);
      await fetchJson(fetchImpl, url, {
        method: "DELETE"
      });
    },
    async update(params) {
      const credentialId = params.credentialId;
      const url = buildUrl(mountPath, `/credentials/${encodeURIComponent(credentialId)}`);
      const response = await fetchJson(fetchImpl, url, {
        method: "PATCH",
        body: JSON.stringify({
          nickname: params.nickname
        })
      });
      if (response && typeof response === "object" && "credential" in response) {
        return response.credential;
      }
      throw new PasskeyClientError("Unexpected response when updating credential", 500, response);
    }
  };
};
export {
  WebAuthnAbortService,
  WebAuthnError,
  _browserSupportsWebAuthnAutofillInternals,
  _browserSupportsWebAuthnInternals,
  base64URLStringToBuffer,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  bufferToBase64URLString,
  createClient,
  createDpopProof,
  generateDpopKeyPair,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration
};
