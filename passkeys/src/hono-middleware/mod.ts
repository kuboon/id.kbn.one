import type {
  AuthenticationVerifyRequestBody,
  PasskeyCredential,
  PasskeyMiddlewareOptions,
  PasskeyStorage,
  PasskeyUser,
  RegistrationOptionsRequestBody,
  RegistrationVerifyRequestBody,
} from "../core/types.ts";
import { generateCredentialNickname } from "../core/generate-credential-nickname.ts";

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
import { serveStatic } from "hono/deno";
import { createMiddleware } from "hono/factory";
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

export const SESSION_COOKIE_NAME = "passkey_session";

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
    secret: _secret,
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

  const loadSessionUser = (c: Context): Promise<PasskeyUser | null> => {
    const session = c.get("session");
    const userId = session?.userId;
    if (!userId || typeof userId !== "string") return Promise.resolve(null);
    try {
      return storage.getUserById(userId);
    } catch {
      return Promise.resolve(null);
    }
  };

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

  const router = new Hono();
  router.get("/credentials", async (c) => {
    c.header("Cache-Control", "no-store");
    const user = c.get("user");
    if (!user) throw jsonError(401, "Sign-in required");
    const credentials = await storage.getCredentialsByUserId(user.id);
    return c.json({ user, credentials });
  });

  router.delete("/credentials/:credentialId", async (c) => {
    c.header("Cache-Control", "no-store");
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
  });

  router.patch("/credentials/:credentialId", async (c) => {
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
  });

  router.post("/register/options", async (c) => {
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
    const session = c.get("session") || {};
    c.set("session", {
      ...session,
      challenge: optionsResult.challenge,
      origin: requestUrl.origin,
    });
    return c.json(optionsResult);
  });

  router.post("/register/verify", async (c) => {
    setNoStore(c);
    const body = await ensureJsonBody<RegistrationVerifyRequestBody>(c);
    const username = body.username?.trim();
    if (!username) {
      throw jsonError(400, "username is required");
    }
    const user = await ensureUserOrThrow(username);
    const existingCredentials = await storage.getCredentialsByUserId(user.id);
    const session = c.get("session");
    const storedChallenge = session?.challenge;
    const storedOrigin = session?.origin;
    if (!storedChallenge || typeof storedChallenge !== "string") {
      throw jsonError(400, "No registration challenge for user");
    }
    if (!storedOrigin || typeof storedOrigin !== "string") {
      throw jsonError(400, "No origin for challenge");
    }
    const expectedChallenge = storedChallenge;
    const expectedOrigin = storedOrigin;

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

    // Mark the user as authenticated in the session so they are logged in
    // immediately after registering a passkey.
    const currentSession = c.get("session") || {};
    c.set("session", {
      ...currentSession,
      userId: user.id,
      challenge: undefined,
      origin: undefined,
    });

    return c.json({
      verified: verification.verified,
      credential: storedCredential,
    });
  });

  router.post("/authenticate/options", async (c) => {
    setNoStore(c);
    const requestUrl = getRequestUrl(c);

    const optionsInput = {
      rpID: requestUrl.hostname,
      userVerification: "preferred",
      ...authenticationOptions,
    } satisfies GenerateAuthenticationOptionsOpts;

    const optionsResult = await webauthn.generateAuthenticationOptions(
      optionsInput,
    );
    const session = c.get("session") || {};
    c.set("session", {
      ...session,
      challenge: optionsResult.challenge,
      origin: requestUrl.origin,
    });

    return c.json(optionsResult);
  });

  router.post("/authenticate/verify", async (c) => {
    setNoStore(c);
    const rawBody = (await ensureJsonBody<unknown>(c)) as Record<
      string,
      unknown
    >;
    const body = (rawBody as unknown) as
      & Partial<AuthenticationVerifyRequestBody>
      & {
        challenge?: string;
        origin?: string;
      };
    if (!body.credential) throw jsonError(400, "credential is required");

    const storedCredential = await storage.getCredentialById(
      body.credential.id,
    );
    if (!storedCredential) throw jsonError(401, "Credential not found");

    const session = c.get("session");
    const storedChallenge = session?.challenge;
    const storedOrigin = session?.origin;
    if (!storedChallenge || typeof storedChallenge !== "string") {
      throw jsonError(400, "No authentication challenge for user");
    }
    if (!storedOrigin || typeof storedOrigin !== "string") {
      throw jsonError(400, "No origin for challenge");
    }

    const expectedChallenge = storedChallenge;
    const expectedOrigin = storedOrigin;

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

    storedCredential.counter = authenticationInfo.newCounter;
    storedCredential.updatedAt = Date.now();
    storedCredential.backedUp = authenticationInfo.credentialBackedUp;
    storedCredential.deviceType = authenticationInfo.credentialDeviceType;
    await storage.updateCredential(storedCredential);

    const currentSession = c.get("session") || {};
    c.set("session", {
      ...currentSession,
      userId: storedCredential.userId,
      challenge: undefined,
      origin: undefined,
    });

    return c.json({
      verified: verification.verified,
      credential: storedCredential,
    });
  });

  router.get("*", serveStatic({ root: import.meta.resolve("./static") }));

  router.all("*", (c) => {
    throw jsonError(404, "Endpoint not found for " + c.req.url);
  });

  const middleware = createMiddleware(async (c, next) => {
    const user = await loadSessionUser(c);
    c.set("user", user);
    return next();
  });
  return { router, middleware };
};

export type PasskeyMiddleware = ReturnType<typeof createPasskeyMiddleware>;

export { InMemoryPasskeyStore } from "../core/in-memory-passkey-store.ts";
export * from "../core/types.ts";
