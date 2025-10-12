import { Hono } from "hono";
import type { Context, ExecutionContext } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  GenerateAuthenticationOptionsOpts,
  GenerateRegistrationOptionsOpts,
} from "@simplewebauthn/server";
import {
  AuthenticationOptionsRequestBody,
  AuthenticationVerifyRequestBody,
  PasskeyCredential,
  PasskeyMiddlewareOptions,
  PasskeySessionState,
  PasskeyStorage,
  PasskeyStoredChallenge,
  PasskeyUser,
  RegistrationOptionsRequestBody,
  RegistrationVerifyRequestBody,
} from "./types.ts";
import { base64 } from "@hexagon/base64";
import {
  CHALLENGE_COOKIE_NAME,
  createSignedChallengeValue,
  verifySignedChallengeValue,
} from "./challenge-signature.ts";
import { findAaguidName } from "./aaguid-catalog.ts";

declare module "hono" {
  interface ContextVariableMap {
    passkey: PasskeySessionState;
  }
}

const encodeBase64Url = (input: ArrayBuffer) =>
  base64.fromArrayBuffer(input, true);

const decodeBase64Url = (input: string) =>
  new Uint8Array(base64.toArrayBuffer(input, true));

const DEFAULT_MOUNT_PATH = "/webauthn";
const SESSION_COOKIE_NAME = "passkey_session";
const cookieBaseOptions = {
  httpOnly: true,
  sameSite: "Lax" as const,
  path: "/",
};
const CHALLENGE_COOKIE_MAX_AGE_SECONDS = 300;

const isSecureRequest = (c: Context) => c.req.url.startsWith("https://");

const setSignedChallengeCookie = async (
  c: Context,
  payload: {
    userId: string;
    type: "registration" | "authentication";
    value: PasskeyStoredChallenge;
  },
) => {
  const signedValue = await createSignedChallengeValue(payload);
  setCookie(c, CHALLENGE_COOKIE_NAME, signedValue, {
    ...cookieBaseOptions,
    secure: isSecureRequest(c),
    maxAge: CHALLENGE_COOKIE_MAX_AGE_SECONDS,
  });
};

const clearSignedChallengeCookie = (c: Context) => {
  setCookie(c, CHALLENGE_COOKIE_NAME, "", {
    ...cookieBaseOptions,
    secure: isSecureRequest(c),
    maxAge: 0,
  });
};

const readSignedChallenge = async (
  c: Context,
  expected: { userId: string; type: "registration" | "authentication" },
): Promise<PasskeyStoredChallenge | null> => {
  const token = getCookie(c, CHALLENGE_COOKIE_NAME);
  const result = await verifySignedChallengeValue(token, expected);
  if (!result) {
    clearSignedChallengeCookie(c);
  }
  return result;
};

const normalizeMountPath = (path: string) => {
  if (!path || path === "/") return "";
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
};

const jsonError = (status: ContentfulStatusCode, message: string) =>
  new HTTPException(status, { message });

const getErrorDetails = (
  error: unknown,
): { code?: string; message?: string } => {
  if (typeof error !== "object" || error === null) {
    return {};
  }
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : undefined;
  const message = typeof record.message === "string"
    ? record.message
    : undefined;
  return { code, message };
};

const ensureUser = (
  storage: PasskeyStorage,
  username: string,
): Promise<PasskeyUser | null> => {
  const normalized = username.trim();
  if (!normalized) {
    return Promise.resolve(null);
  }
  return storage.getUserByUsername(normalized);
};

const respond = <T>(handler: () => Promise<T>) =>
  handler().catch((error: unknown) => {
    if (error instanceof HTTPException) {
      throw error;
    }
    if (error instanceof Error) {
      throw new HTTPException(500, { message: error.message, cause: error });
    }
    throw new HTTPException(500, { message: "Unexpected error", cause: error });
  });

const unauthenticatedState = (): PasskeySessionState => ({
  isAuthenticated: false,
  user: null,
});

const matchesMountPath = (path: string, mountPath: string) =>
  mountPath === "" || path === mountPath || path.startsWith(`${mountPath}/`);

const getExecutionContext = (c: Context): ExecutionContext | undefined => {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
};

const getRequestUrl = (c: Context): URL => {
  const headerOrigin = c.req.header("origin")?.trim();
  if (headerOrigin) {
    return new URL(headerOrigin);
  }
  try {
    return new URL(c.req.url);
  } catch {
    throw jsonError(400, "Unable to determine request origin");
  }
};

const usesRoamingTransport = (transports?: readonly string[]) => {
  if (!Array.isArray(transports)) {
    return false;
  }
  return transports.some((transport) => {
    const value = typeof transport === "string" ? transport.toLowerCase() : "";
    return value === "usb" || value === "nfc" || value === "ble";
  });
};

const describeAuthenticator = (
  deviceType: string | undefined,
  backedUp: boolean | undefined,
  transports?: readonly string[],
) => {
  if (usesRoamingTransport(transports)) {
    return "セキュリティキー";
  }
  if (
    Array.isArray(transports) &&
    transports.some((value) => value === "internal")
  ) {
    if (deviceType === "multiDevice") {
      return backedUp ? "同期済みパスキー" : "マルチデバイスパスキー";
    }
    return "このデバイスのパスキー";
  }
  if (deviceType === "multiDevice") {
    return backedUp ? "同期済みパスキー" : "マルチデバイスパスキー";
  }
  if (deviceType === "singleDevice") {
    return "このデバイスのパスキー";
  }
  return backedUp ? "同期済みパスキー" : "パスキー";
};

const guessNicknameFromUserAgent = (userAgent: string | undefined | null) => {
  if (!userAgent) {
    return null;
  }
  const ua = userAgent.toLowerCase();
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) {
    return "このiOSデバイスのパスキー";
  }
  if (ua.includes("mac os x") || ua.includes("macintosh")) {
    return "このMacのパスキー";
  }
  if (ua.includes("android")) {
    if (ua.includes("pixel")) {
      return "このPixelのパスキー";
    }
    return "Android デバイスのパスキー";
  }
  if (ua.includes("windows")) {
    return "Windows デバイスのパスキー";
  }
  if (ua.includes("linux")) {
    return "Linux デバイスのパスキー";
  }
  return null;
};

const ensureUniqueNickname = (
  base: string,
  existingCredentials: PasskeyCredential[],
) => {
  const trimmed = base.trim() || "パスキー";
  const used = new Set(
    existingCredentials
      .map((credential) => credential.nickname?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );
  if (!used.has(trimmed.toLowerCase())) {
    return trimmed;
  }
  let index = 2;
  while (used.has(`${trimmed} (${index})`.toLowerCase())) {
    index += 1;
  }
  return `${trimmed} (${index})`;
};

const generateCredentialNickname = (
  options: {
    aaguid?: string | null;
    deviceType?: string;
    backedUp?: boolean;
    transports?: readonly string[];
    existingCredentials: PasskeyCredential[];
    userAgent?: string | null;
  },
) => {
  const datasetName = findAaguidName(options.aaguid);
  const userAgentName = guessNicknameFromUserAgent(options.userAgent);
  const fallback = describeAuthenticator(
    options.deviceType,
    options.backedUp,
    options.transports,
  );
  const base = datasetName ?? userAgentName ?? fallback ?? "パスキー";
  return ensureUniqueNickname(base, options.existingCredentials);
};

export const createPasskeyMiddleware = (
  options: PasskeyMiddlewareOptions,
) => {
  const {
    rpName,
    storage,
    registrationOptions,
    authenticationOptions,
    verifyRegistrationOptions,
    verifyAuthenticationOptions,
  } = options;
  const webauthn = {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
    ...options.webauthn,
  };
  const mountPath = normalizeMountPath(
    options.mountPath ?? DEFAULT_MOUNT_PATH,
  );
  const router = new Hono();

  const loadSessionState = async (c: Context): Promise<PasskeySessionState> => {
    const sessionValue = getCookie(c, SESSION_COOKIE_NAME)?.trim();
    if (!sessionValue) {
      return unauthenticatedState();
    }
    try {
      const user = await storage.getUserById(sessionValue);
      if (!user) {
        return unauthenticatedState();
      }
      return { isAuthenticated: true, user };
    } catch {
      return unauthenticatedState();
    }
  };

  const updateSessionState = (c: Context, state: PasskeySessionState) => {
    c.set("passkey", state);
  };

  const routes = mountPath ? router.basePath(mountPath) : router;

  const ensureJsonBody = async <T>(c: Context) => {
    try {
      return (await c.req.json()) as T;
    } catch {
      throw jsonError(400, "Invalid JSON payload");
    }
  };

  const ensureUserOrThrow = async (username: string) => {
    const user = await ensureUser(storage, username);
    if (!user) {
      throw jsonError(404, "User not found");
    }
    return user;
  };

  const setNoStore = (c: Context) => {
    c.header("Cache-Control", "no-store");
  };

  const clientJsPromise = Deno.readTextFile(
    new URL(import.meta.resolve("../_dist/client.js")),
  );
  routes.get("/client.js", (c) =>
    respond(async () => {
      setNoStore(c);
      const bundle = await clientJsPromise;
      c.header("Content-Type", "application/javascript; charset=utf-8");
      return c.body(bundle);
    }));

  routes.get("/credentials", (c) =>
    respond(async () => {
      setNoStore(c);
      const username = c.req.query("username")?.trim();
      if (!username) {
        throw jsonError(400, "Missing username query parameter");
      }
      const user = await ensureUser(storage, username);
      if (!user) {
        return c.json({ user: null, credentials: [] });
      }
      const credentials = await storage.getCredentialsByUserId(user.id);
      return c.json({ user, credentials });
    }));

  routes.delete("/credentials/:credentialId", (c) =>
    respond(async () => {
      setNoStore(c);
      if (!storage.deleteCredential) {
        throw jsonError(405, "Credential deletion not supported");
      }
      const credentialIdParam = c.req.param("credentialId");
      const credentialId = credentialIdParam
        ? decodeURIComponent(credentialIdParam)
        : "";
      const username = c.req.query("username")?.trim();
      if (!credentialId) {
        throw jsonError(400, "Missing credential identifier");
      }
      if (!username) {
        throw jsonError(400, "Missing username query parameter");
      }
      const user = await ensureUserOrThrow(username);
      const credential = await storage.getCredentialById(credentialId);
      if (!credential || credential.userId !== user.id) {
        throw jsonError(404, "Credential not found");
      }
      await storage.deleteCredential(credentialId);
      return c.json({ success: true });
    }));

  routes.post("/register/options", (c) =>
    respond(async () => {
      setNoStore(c);
      const body = await ensureJsonBody<RegistrationOptionsRequestBody>(c);
      const username = body.username?.trim();
      if (!username) {
        throw jsonError(400, "username is required");
      }
      let user = await ensureUser(storage, username);
      if (!user) {
        // Do not collect or store a separate displayName; use username instead
        user = {
          id: crypto.randomUUID(),
          username,
        } satisfies PasskeyUser;
        try {
          await storage.createUser(user);
        } catch (error: unknown) {
          const { code, message } = getErrorDetails(error);
          if (code === "USER_EXISTS" || message?.includes("exists")) {
            user = await ensureUser(storage, username);
            if (!user) {
              throw jsonError(
                500,
                "Failed to fetch existing user after duplicate creation error",
              );
            }
          } else {
            throw error;
          }
        }
      }

      const requestUrl = getRequestUrl(c);
      const existingCredentials = await storage.getCredentialsByUserId(user.id);
      const optionsInput: GenerateRegistrationOptionsOpts = {
        rpName,
        rpID: requestUrl.hostname,
        userName: user.username,
        // userDisplayName intentionally set to username to avoid storing extra data
        userDisplayName: user.username,
        excludeCredentials: existingCredentials.map((credential) => ({
          id: credential.id,
          transports: credential.transports,
        })),
        ...registrationOptions,
      };

      const optionsResult = await webauthn.generateRegistrationOptions(
        optionsInput,
      );
      await setSignedChallengeCookie(c, {
        userId: user.id,
        type: "registration",
        value: {
          challenge: optionsResult.challenge,
          origin: requestUrl.origin,
        },
      });
      return c.json(optionsResult);
    }));

  routes.post("/register/verify", (c) =>
    respond(async () => {
      setNoStore(c);
      const body = await ensureJsonBody<RegistrationVerifyRequestBody>(c);
      const username = body.username?.trim();
      if (!username) {
        throw jsonError(400, "username is required");
      }
      const user = await ensureUserOrThrow(username);
      const existingCredentials = await storage.getCredentialsByUserId(user.id);
      const storedChallenge = await readSignedChallenge(c, {
        userId: user.id,
        type: "registration",
      });
      if (!storedChallenge) {
        throw jsonError(400, "No registration challenge for user");
      }
      const expectedChallenge = storedChallenge.challenge;
      const expectedOrigin = storedChallenge.origin;

      const verification = await webauthn.verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: new URL(expectedOrigin).hostname,
        ...verifyRegistrationOptions,
      });

      const { registrationInfo } = verification;
      if (!registrationInfo) {
        throw jsonError(400, "Registration could not be verified");
      }
      const registrationCredential = registrationInfo.credential;
      const credentialId = registrationCredential.id;
      const credentialPublicKey = encodeBase64Url(
        registrationCredential.publicKey.buffer,
      );
      const credentialAaguid = (() => {
        const fromCredential = (registrationCredential as { aaguid?: unknown })
          .aaguid;
        if (typeof fromCredential === "string" && fromCredential.trim()) {
          return fromCredential;
        }
        const fromInfo = (registrationInfo as { aaguid?: unknown }).aaguid;
        return typeof fromInfo === "string" ? fromInfo : null;
      })();
      const transports = registrationCredential.transports ??
        body.credential.response.transports;
      const nickname = generateCredentialNickname({
        aaguid: credentialAaguid,
        deviceType: registrationInfo.credentialDeviceType,
        backedUp: registrationInfo.credentialBackedUp,
        transports,
        existingCredentials,
        userAgent: c.req.header("user-agent"),
      });

      const now = Date.now();
      const storedCredential: PasskeyCredential = {
        id: credentialId,
        userId: user.id,
        nickname,
        publicKey: credentialPublicKey,
        counter: registrationCredential.counter,
        transports,
        deviceType: registrationInfo.credentialDeviceType,
        backedUp: registrationInfo.credentialBackedUp,
        createdAt: now,
        updatedAt: now,
      };

      await storage.saveCredential(storedCredential);
      clearSignedChallengeCookie(c);

      // Mark the user as authenticated in the session so they are logged in
      // immediately after registering a passkey.
      const secure = c.req.url.startsWith("https://");
      setCookie(c, SESSION_COOKIE_NAME, user.id, {
        ...cookieBaseOptions,
        secure,
      });
      const sessionState: PasskeySessionState = {
        isAuthenticated: true,
        user,
      };
      updateSessionState(c, sessionState);

      return c.json({
        verified: verification.verified,
        credential: storedCredential,
      });
    }));

  routes.post("/authenticate/options", (c) =>
    respond(async () => {
      setNoStore(c);
      const body = await ensureJsonBody<AuthenticationOptionsRequestBody>(c);
      const username = body.username?.trim();
      const requestUrl = getRequestUrl(c);

      let optionsInput: GenerateAuthenticationOptionsOpts;
      if (username) {
        // username-based flow: restrict to credentials for that user
        const user = await ensureUserOrThrow(username);
        const credentials = await storage.getCredentialsByUserId(user.id);
        if (credentials.length === 0) {
          throw jsonError(404, "No registered credentials for user");
        }
        optionsInput = {
          rpID: requestUrl.hostname,
          allowCredentials: credentials.map((credential) => ({
            id: credential.id,
            transports: credential.transports,
          })),
          userVerification: "preferred",
          ...authenticationOptions,
        };
      } else {
        // conditional / discoverable credentials flow: do not set allowCredentials
        optionsInput = {
          rpID: requestUrl.hostname,
          userVerification: "preferred",
          ...authenticationOptions,
        };
      }

      const optionsResult = await webauthn.generateAuthenticationOptions(
        optionsInput,
      );

      await setSignedChallengeCookie(c, {
        userId: username ? (await ensureUserOrThrow(username)).id : "",
        type: "authentication",
        value: {
          challenge: optionsResult.challenge,
          origin: requestUrl.origin,
        },
      });

      return c.json(optionsResult);
    }));

  routes.post("/authenticate/verify", (c) =>
    respond(async () => {
      setNoStore(c);
      const rawBody = (await ensureJsonBody<unknown>(c)) as Record<
        string,
        unknown
      >;
      const body = (rawBody as unknown) as AuthenticationVerifyRequestBody & {
        challenge?: string;
        origin?: string;
      };
      const username = body.username?.trim();

      let expectedChallenge: string;
      let expectedOrigin: string;
      let storedCredential: PasskeyCredential | null = null;
      let user: PasskeyUser | null = null;

      if (username) {
        // username-based verification
        user = await ensureUserOrThrow(username);
        const storedChallenge = await readSignedChallenge(c, {
          userId: user.id,
          type: "authentication",
        });
        if (!storedChallenge) {
          throw jsonError(400, "No authentication challenge for user");
        }
        expectedChallenge = storedChallenge.challenge;
        expectedOrigin = storedChallenge.origin;

        const credentialId = body.credential.id;
        storedCredential = await storage.getCredentialById(credentialId);
        if (!storedCredential || storedCredential.userId !== user.id) {
          throw jsonError(404, "Credential not found");
        }
      } else {
        // conditional (discoverable) verification: user not supplied
        const storedChallenge = await readSignedChallenge(c, {
          userId: "",
          type: "authentication",
        });
        if (storedChallenge) {
          expectedChallenge = storedChallenge.challenge;
          expectedOrigin = storedChallenge.origin;
        } else {
          // fallback: client may include challenge/origin in body
          expectedChallenge = body.challenge ?? "";
          expectedOrigin = body.origin ?? "";
          if (!expectedChallenge || !expectedOrigin) {
            throw jsonError(400, "No authentication challenge");
          }
        }

        const credentialId = body.credential?.id;
        if (!credentialId) {
          throw jsonError(400, "Credential missing");
        }
        storedCredential = await storage.getCredentialById(credentialId);
        if (!storedCredential) {
          throw jsonError(404, "Credential not found");
        }
        // determine user from credential
        user = await storage.getUserById(storedCredential.userId);
        if (!user) {
          throw jsonError(404, "User not found");
        }
      }

      const verification = await webauthn.verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: new URL(expectedOrigin).hostname,
        credential: {
          id: storedCredential.id,
          publicKey: decodeBase64Url(storedCredential.publicKey),
          counter: storedCredential.counter,
          transports: storedCredential.transports,
        },
        ...verifyAuthenticationOptions,
      });

      const { authenticationInfo } = verification;
      if (!authenticationInfo) {
        throw jsonError(400, "Authentication could not be verified");
      }

      storedCredential!.counter = authenticationInfo.newCounter;
      storedCredential!.updatedAt = Date.now();
      storedCredential!.backedUp = authenticationInfo.credentialBackedUp;
      storedCredential!.deviceType = authenticationInfo.credentialDeviceType;
      await storage.updateCredential(storedCredential!);
      clearSignedChallengeCookie(c);

      const secure = c.req.url.startsWith("https://");
      setCookie(c, SESSION_COOKIE_NAME, user!.id, {
        ...cookieBaseOptions,
        secure,
      });
      const sessionState: PasskeySessionState = {
        isAuthenticated: true,
        user,
      };
      updateSessionState(c, sessionState);

      return c.json({
        verified: verification.verified,
        credential: storedCredential,
      });
    }));

  routes.all("*", () => {
    throw jsonError(404, "Endpoint not found");
  });

  return createMiddleware(async (c, next) => {
    const state = await loadSessionState(c);
    updateSessionState(c, state);

    if (matchesMountPath(c.req.path, mountPath)) {
      const executionCtx = getExecutionContext(c);
      return router.fetch(c.req.raw, c.env, executionCtx);
    }

    return next();
  });
};

export type PasskeyMiddleware = ReturnType<typeof createPasskeyMiddleware>;

export { InMemoryPasskeyStore } from "./in-memory-passkey-store.ts";
export * from "./types.ts";
