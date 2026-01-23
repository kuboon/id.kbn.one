import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  CredentialDeviceType,
  GenerateAuthenticationOptionsOpts,
  GenerateRegistrationOptionsOpts,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
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

export interface PasskeyStorage {
  getUserById(userId: string): Promise<boolean>;
  createUser(userId: string): Promise<void>;
  deleteUser?(userId: string): Promise<void>;
  getCredentialById(credentialId: string): Promise<PasskeyCredential | null>;
  getCredentialsByUserId(userId: string): Promise<PasskeyCredential[]>;
  saveCredential(credential: PasskeyCredential): Promise<void>;
  updateCredential(credential: PasskeyCredential): Promise<void>;
  deleteCredential(credentialId: string): Promise<void>;
}

export type ChallengeType = "registration" | "authentication";

export interface PasskeyStoredChallenge {
  challenge: string;
  origin: string;
}

export interface RegistrationOptionsRequestBody {
  userId: string;
}

export interface RegistrationVerifyRequestBody {
  userId: string;
  credential: RegistrationResponseJSON;
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
  storage: PasskeyStorage;
  secret: string;
  mountPath?: string;
  registrationOptions?: RegistrationOptionsOverrides;
  authenticationOptions?: AuthenticationOptionsOverrides;
  verifyRegistrationOptions?: VerifyRegistrationOverrides;
  verifyAuthenticationOptions?: VerifyAuthenticationOverrides;
  webauthn?: PasskeyWebAuthnOverrides;
}
