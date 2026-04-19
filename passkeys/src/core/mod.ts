import { base64 } from "@hexagon/base64";
import { createHmacHelpers } from "./hmac.ts";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  GenerateAuthenticationOptionsOpts,
  GenerateRegistrationOptionsOpts,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";

import { generateCredentialNickname } from "./generate-credential-nickname.ts";
import type { PasskeyCredential, PasskeyMiddlewareOptions } from "./types.ts";

const encodeBase64Url = (input: ArrayBuffer) =>
  base64.fromArrayBuffer(input, true);
const decodeBase64Url = (input: string) =>
  new Uint8Array(base64.toArrayBuffer(input, true));

export function createPasskeysCore(options: PasskeyMiddlewareOptions) {
  const {
    rpName,
    storage,
  } = options;

  // cached secret promise
  let signSecretPromise: Promise<string> | null = null;
  const getSignSecret = async () => {
    if (!signSecretPromise) {
      signSecretPromise = storage.getOrCreateSignSecret(() => {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        return base64.fromArrayBuffer(bytes.buffer, true);
      });
    }
    return await signSecretPromise;
  };

  // HMAC helpers (sign/verify) are provided by separate module
  const { signToken, verifyToken } = createHmacHelpers(
    getSignSecret as () => Promise<string>,
  );

  return {
    async registrationOptionsForUser({ userName, requestUrl }: {
      userName: string;
      requestUrl: URL;
    }) {
      const existingCredentials = await storage.getCredentialsByUserId(
        userName,
      );
      const userID = new TextEncoder().encode(userName);
      const optionsInput: GenerateRegistrationOptionsOpts = {
        rpName,
        rpID: requestUrl.hostname,
        userID,
        userName,
        userDisplayName: userName,
        excludeCredentials: existingCredentials.map((credential) => ({
          id: credential.id,
          transports: credential.transports,
        })),
      };

      const optionsResult = await generateRegistrationOptions(
        optionsInput,
      );

      const sessionObj = {
        userId: userName,
        challenge: optionsResult.challenge,
        origin: requestUrl.origin,
        type: "registration",
        exp: Math.floor(Date.now() / 1000) + 300,
      };
      const sessionToken = await signToken(sessionObj);

      return { optionsResult, sessionToken };
    },

    async verifyRegistration(
      { body, sessionToken, requestUrl: _requestUrl, userAgent }: {
        body: unknown;
        sessionToken: string;
        requestUrl: URL;
        userAgent?: string;
      },
    ) {
      const session = await verifyToken(sessionToken);
      const userId = session.userId!;

      const verification = await verifyRegistrationResponse({
        response: body as RegistrationResponseJSON,
        expectedChallenge: session.challenge!,
        expectedOrigin: session.origin!,
        expectedRPID: new URL(session.origin!).hostname,
      });

      const registrationInfo = verification.registrationInfo;
      if (!registrationInfo) return { verified: false } as const;

      const registrationCredential = registrationInfo.credential;
      const credentialId = registrationCredential.id;
      const credentialPublicKey = encodeBase64Url(
        registrationCredential.publicKey.buffer,
      );

      const existingCredentials = await storage.getCredentialsByUserId(userId);
      const transports = registrationCredential.transports;

      const nickname = generateCredentialNickname({
        aaguid: registrationInfo.aaguid,
        deviceType: registrationInfo.credentialDeviceType,
        backedUp: registrationInfo.credentialBackedUp,
        transports,
        existingCredentials,
        userAgent,
      });

      const now = Date.now();
      const storedCredential: PasskeyCredential = {
        id: credentialId,
        userId,
        nickname,
        publicKey: credentialPublicKey,
        counter: registrationCredential.counter ?? 0,
        transports,
        deviceType: registrationInfo.credentialDeviceType,
        backedUp: Boolean(
          registrationInfo.credentialBackedUp ?? false,
        ) as boolean,
        createdAt: now,
        updatedAt: now,
      };

      await storage.addCredential(storedCredential);

      return {
        verified: verification.verified,
        credential: storedCredential,
      };
    },

    async authenticationOptions({ requestUrl }: { requestUrl: URL }) {
      const optionsInput = {
        rpID: requestUrl.hostname,
        userVerification: "preferred",
      } satisfies GenerateAuthenticationOptionsOpts;

      const optionsResult = await generateAuthenticationOptions(
        optionsInput,
      );

      const sessionObj = {
        challenge: optionsResult.challenge,
        origin: requestUrl.origin,
        type: "authentication",
        exp: Math.floor(Date.now() / 1000) + 300,
      };
      const sessionToken = await signToken(sessionObj);
      return { optionsResult, sessionToken };
    },

    async verifyAuthentication({ body, sessionToken }: {
      body: unknown;
      sessionToken: string;
    }) {
      const session = await verifyToken(sessionToken);
      const storedChallenge = session?.challenge as unknown as
        | string
        | undefined;
      const storedOrigin = session?.origin as unknown as string | undefined;
      if (!storedChallenge || !storedOrigin) {
        throw new Error("No session challenge/origin");
      }

      const expectedChallenge = storedChallenge;
      const expectedOrigin = storedOrigin;
      const expectedRPID = new URL(expectedOrigin).hostname;

      const response = body as AuthenticationResponseJSON;
      const storedCredential = await storage.getCredentialById(
        response.id,
      );
      if (!storedCredential) {
        class NotFoundError extends Error {
          status = 401;
        }
        throw new NotFoundError("Credential not found");
      }

      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin,
        expectedRPID,
        credential: {
          id: storedCredential.id,
          publicKey: decodeBase64Url(storedCredential.publicKey),
          counter: storedCredential.counter,
          transports: storedCredential.transports,
        },
      });

      const verificationRes =
        verification as unknown as VerifiedAuthenticationResponse;
      const authenticationInfo = verificationRes.authenticationInfo;
      if (!authenticationInfo) return { verified: false } as const;

      storedCredential.counter = authenticationInfo.newCounter;
      storedCredential.updatedAt = Date.now();
      storedCredential.backedUp = authenticationInfo.credentialBackedUp;
      storedCredential.deviceType = authenticationInfo.credentialDeviceType;
      await storage.updateCredential(storedCredential);

      return {
        verified: verificationRes.verified,
        credential: storedCredential,
      };
    },
  };
}

export type { PasskeyCredential, PasskeyMiddlewareOptions } from "./types.ts";
