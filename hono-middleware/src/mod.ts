import {
  AuthenticationOptionsRequestBody,
  AuthenticationVerifyRequestBody,
  PasskeyCredential,
  PasskeyMiddlewareOptions,
  PasskeyStorage,
  PasskeyStoredChallenge,
  PasskeyUser,
  RegistrationOptionsRequestBody,
  RegistrationVerifyRequestBody,
} from "./types.ts";
import { generateCredentialNickname } from "./generate-credential-nickname.ts";

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
import { base64 } from "@hexagon/base64";

import { type Context, Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
  deleteCookie,
  getCookie,
  getSignedCookie,
  setCookie,
  setSignedCookie,
} from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

declare module "hono" {
  interface ContextVariableMap {
    user: PasskeyUser | null;
  }
}

const encodeBase64Url = (input: ArrayBuffer) =>
  base64.fromArrayBuffer(input, true);

const decodeBase64Url = (input: string) =>
  new Uint8Array(base64.toArrayBuffer(input, true));

const cookieJar = <T>(
  name: string,
  opt?: { maxAge: number },
  secret?: string,
) =>
(c: Context) => {
  const secure = c.req.url.startsWith("https://");
  const opt_ = {
    httpOnly: true,
    sameSite: "Lax" as const,
    path: "/",
    secure,
    ...opt,
  };
  return {
    async set(payload: T) {
      if (secret) {
        await setSignedCookie(c, name, JSON.stringify(payload), secret, opt_);
      } else {
        setCookie(c, name, JSON.stringify(payload), opt_);
      }
    },
    async get(): Promise<T | undefined> {
      let value;
      if (secret) {
        value = await getSignedCookie(c, secret, name);
      } else {
        value = getCookie(c, name);
      }
      return value ? JSON.parse(value) : undefined;
    },
    clear: () => deleteCookie(c, name),
  };
};
export const SESSION_COOKIE_NAME = "passkey_session";
const CHALLENGE_COOKIE_NAME = "passkey_challenge";
const CHALLENGE_COOKIE_MAX_AGE_SECONDS = 300;

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

export const createPasskeyMiddleware = (
  options: PasskeyMiddlewareOptions,
) => {
  const {
    rpName,
    storage,
    secret,
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
  const sessionCookieJar = cookieJar<string>(
    SESSION_COOKIE_NAME,
    { maxAge: 7 * 24 * 60 * 60 },
    secret,
  );
  const challengeCookieJar = cookieJar<PasskeyStoredChallenge>(
    CHALLENGE_COOKIE_NAME,
    { maxAge: CHALLENGE_COOKIE_MAX_AGE_SECONDS },
    secret,
  );

  const loadSessionUser = async (c: Context): Promise<PasskeyUser | null> => {
    const sessionValue = (await sessionCookieJar(c).get())?.trim();
    if (!sessionValue) return null;
    try {
      return storage.getUserById(sessionValue);
    } catch {
      return null;
    }
  };

  const router = new Hono();

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
  router.get("/client.js", (c) =>
    respond(async () => {
      setNoStore(c);
      const bundle = await clientJsPromise;
      c.header("Content-Type", "application/javascript; charset=utf-8");
      return c.body(bundle);
    }));

  router.get("/credentials", (c) =>
    respond(async () => {
      setNoStore(c);
      const user = c.get("user");
      if (!user) throw jsonError(401, "Sign-in required");
      const credentials = await storage.getCredentialsByUserId(user.id);
      return c.json({ user, credentials });
    }));

  router.delete("/credentials/:credentialId", (c) =>
    respond(async () => {
      setNoStore(c);
      const user = c.get("user");
      if (!user) throw jsonError(401, "Sign-in required");
      const credentialId = c.req.param("credentialId");
      if (!credentialId) {
        throw jsonError(400, "Missing credential identifier");
      }
      const credential = await storage.getCredentialById(credentialId);
      if (!credential || credential.userId !== user.id) {
        throw jsonError(404, "Credential not found");
      }
      await storage.deleteCredential(credentialId);
      return c.json({ success: true });
    }));

  router.patch("/credentials/:credentialId", (c) =>
    respond(async () => {
      setNoStore(c);
      const user = c.get("user");
      if (!user) throw jsonError(401, "Sign-in required");
      const credentialId = c.req.param("credentialId");
      if (!credentialId) {
        throw jsonError(400, "Missing credential identifier");
      }
      const body = await ensureJsonBody<{ nickname?: string }>(c);
      const nickname = body.nickname?.trim();
      if (!nickname) {
        throw jsonError(400, "nickname is required");
      }
      const credential = await storage.getCredentialById(credentialId);
      if (!credential || credential.userId !== user.id) {
        throw jsonError(404, "Credential not found");
      }
      if (credential.nickname !== nickname) {
        credential.nickname = nickname;
        credential.updatedAt = Date.now();
        await storage.updateCredential(credential);
      }
      return c.json({ credential });
    }));

  router.post("/register/options", (c) =>
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
      await challengeCookieJar(c).set({
        challenge: optionsResult.challenge,
        origin: requestUrl.origin,
      });
      return c.json(optionsResult);
    }));

  router.post("/register/verify", (c) =>
    respond(async () => {
      setNoStore(c);
      const body = await ensureJsonBody<RegistrationVerifyRequestBody>(c);
      const username = body.username?.trim();
      if (!username) {
        throw jsonError(400, "username is required");
      }
      const user = await ensureUserOrThrow(username);
      const existingCredentials = await storage.getCredentialsByUserId(user.id);
      const storedChallenge = await challengeCookieJar(c).get();
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
      challengeCookieJar(c).clear();

      // Mark the user as authenticated in the session so they are logged in
      // immediately after registering a passkey.
      await sessionCookieJar(c).set(user.id);

      return c.json({
        verified: verification.verified,
        credential: storedCredential,
      });
    }));

  router.post("/authenticate/options", (c) =>
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
      await challengeCookieJar(c).set({
        challenge: optionsResult.challenge,
        origin: requestUrl.origin,
      });

      return c.json(optionsResult);
    }));

  router.post("/authenticate/verify", (c) =>
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
        const storedChallenge = await challengeCookieJar(c).get();
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
        const storedChallenge = await challengeCookieJar(c).get();
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
      challengeCookieJar(c).clear();

      await sessionCookieJar(c).set(user.id);

      return c.json({
        verified: verification.verified,
        credential: storedCredential,
      });
    }));

  router.all("*", () => {
    throw jsonError(404, "Endpoint not found");
  });

  const middleware = createMiddleware(async (c, next) => {
    const user = await loadSessionUser(c);
    c.set("user", user);
    return next();
  });
  return { router, middleware };
};

export type PasskeyMiddleware = ReturnType<typeof createPasskeyMiddleware>;

export { InMemoryPasskeyStore } from "./in-memory-passkey-store.ts";
export * from "./types.ts";
