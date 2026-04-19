import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  CredentialDeviceType,
  GenerateAuthenticationOptionsOpts,
  GenerateRegistrationOptionsOpts,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
  VerifyAuthenticationResponseOpts,
  VerifyRegistrationResponseOpts,
} from "@simplewebauthn/server";

export interface PasskeyCredential {
  id: string;
  userId: string;
  nickname: string;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  deviceType?: CredentialDeviceType;
  backedUp?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PasskeyRepository {
  getCredentialById(credentialId: string): Promise<PasskeyCredential | null>;
  getCredentialsByUserId(userId: string): Promise<PasskeyCredential[]>;
  addCredential(credential: PasskeyCredential): Promise<void>;
  updateCredential(credential: PasskeyCredential): Promise<void>;
  deleteCredential(credentialId: string): Promise<void>;
  deleteCredentialsByUserId(userId: string): Promise<void>;
  // Get or create the signing secret used to sign session tokens.
  // The generator should return a base64url-encoded secret string.
  getOrCreateSignSecret(gen: () => Promise<string> | string): Promise<string>;
}

export type ChallengeType = "registration" | "authentication";

export interface RegistrationOptionsRequestBody {
  userId: string;
}

export interface AuthenticationOptionsRequestBody {
  userId?: string;
}

export interface AuthenticationVerifyRequestBody {
  userId?: string;
  credential: AuthenticationResponseJSON;
}

export type RegistrationOptionsOverrides = Partial<
  Omit<
    GenerateRegistrationOptionsOpts,
    | "rpID"
    | "rpName"
    | "userID"
    | "userName"
    | "userDisplayName"
    | "excludeCredentials"
  >
>;

export type AuthenticationOptionsOverrides = Partial<
  Omit<GenerateAuthenticationOptionsOpts, "rpID" | "allowCredentials">
>;

export type VerifyRegistrationOverrides = Partial<
  Omit<
    VerifyRegistrationResponseOpts,
    "response" | "expectedChallenge" | "expectedOrigin" | "expectedRPID"
  >
>;

export type VerifyAuthenticationOverrides = Partial<
  Omit<
    VerifyAuthenticationResponseOpts,
    | "response"
    | "expectedChallenge"
    | "expectedOrigin"
    | "expectedRPID"
    | "credential"
  >
>;

export interface PasskeyWebAuthnOverrides {
  generateRegistrationOptions?: (
    options: GenerateRegistrationOptionsOpts,
  ) => Promise<PublicKeyCredentialCreationOptionsJSON>;
  verifyRegistrationResponse?: (
    options: VerifyRegistrationResponseOpts,
  ) => Promise<VerifiedRegistrationResponse>;
  generateAuthenticationOptions?: (
    options: GenerateAuthenticationOptionsOpts,
  ) => Promise<PublicKeyCredentialRequestOptionsJSON>;
  verifyAuthenticationResponse?: (
    options: VerifyAuthenticationResponseOpts,
  ) => Promise<VerifiedAuthenticationResponse>;
}

export interface PasskeyMiddlewareOptions {
  rpID: string;
  rpName: string;
  storage: PasskeyRepository;
  mountPath?: string;
  getUserId: (
    c: { var: { session?: { userId?: string } } },
  ) => string | undefined;
  updateSession: (
    c: { var: { thumbprint?: string } },
    userId: string,
  ) => Promise<void> | void;
  /** Session token lifetime in seconds (defaults to 300) */
}
