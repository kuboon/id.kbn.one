import type {
  AuthenticationVerifyRequestBody,
  PasskeyCredential,
  PasskeyMiddlewareOptions,
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
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type } from "arktype";
import { sValidator } from "@hono/standard-validator";

const encodeBase64Url = (input: ArrayBuffer) =>
  base64.fromArrayBuffer(input, true);

const decodeBase64Url = (input: string) =>
  new Uint8Array(base64.toArrayBuffer(input, true));

const jsonError = (status: ContentfulStatusCode, message: string) =>
  new HTTPException(status, { message });

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

export const createPasskeysRouter = (
  options: PasskeyMiddlewareOptions,
) => {
  const {
    rpName,
    storage,
    getUserId,
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

  const ensureJsonBody = async <T>(c: Context) => {
    try {
      return (await c.req.json()) as T;
    } catch {
      throw jsonError(400, "Invalid JSON payload");
    }
  };

  const router = new Hono<
    { Variables: { session?: Record<string, unknown> } }
  >()
    .use("*", (c, next) => {
      c.header("Cache-Control", "no-store");
      return next();
    })
    .post(
      "/register/options",
      sValidator("json", type({ "userId?": "string" })),
      async (c) => {
        const sessionUserId = getUserId(c);
        const { userId: newUserId } = c.req.valid("json");
        if (!sessionUserId) {
          if (!newUserId) throw jsonError(400, "userId is required");
          await storage.createUser(newUserId);
        }
        const userId = sessionUserId || newUserId!;
        const requestUrl = getRequestUrl(c);
        const existingCredentials = await storage.getCredentialsByUserId(
          userId,
        );
        const userIdBuffer = new TextEncoder().encode(userId);
        const optionsInput: GenerateRegistrationOptionsOpts = {
          rpName,
          rpID: requestUrl.hostname,
          userID: userIdBuffer,
          userName: userId,
          userDisplayName: userId,
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
          userId,
          challenge: optionsResult.challenge,
          origin: requestUrl.origin,
        });
        return c.json(optionsResult);
      },
    )
    .post("/register/verify", async (c) => {
      const body = await ensureJsonBody<RegistrationVerifyRequestBody>(c);
      const session = c.get("session");
      if (!session) throw jsonError(400, "No session found for user");
      const expectedChallenge = session.challenge;
      const expectedOrigin = session.origin;
      const userId = session.userId;
      if (
        typeof expectedChallenge !== "string" ||
        typeof expectedOrigin !== "string" ||
        typeof userId !== "string"
      ) {
        throw jsonError(400, "Incomplete session for user");
      }

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
      const existingCredentials = await storage.getCredentialsByUserId(userId);
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
        userId: userId,
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
        userId: userId,
        challenge: undefined,
        origin: undefined,
      });

      return c.json({
        verified: verification.verified,
        credential: storedCredential,
      });
    }).post("/authenticate/options", async (c) => {
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
    })
    .post("/authenticate/verify", async (c) => {
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
      const expectedRPID = new URL(expectedOrigin).hostname;

      const storedCredential = await storage.getCredentialById(
        body.credential.id,
      );
      if (!storedCredential) {
        const message = "Credential not found";
        const res = Response.json({ message, rpId: expectedRPID });
        throw new HTTPException(401, { message, res });
      }

      const verification = await webauthn.verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge,
        expectedOrigin,
        expectedRPID,
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

  return router;
};

export * from "../core/types.ts";
