import type { DpopJwtPayload } from "../types.ts";

export interface DpopHttpRequest {
  readonly method: string;
  readonly url: string;
}

export interface DpopProofRequest extends DpopHttpRequest {
  readonly proof: string;
}

export interface CreateDpopProofRequest extends DpopHttpRequest {
  readonly keyPair: CryptoKeyPair;
}

export type VerifyDpopProofResult = {
  valid: true;
  readonly parts: readonly [string, string, string];
  readonly payload: DpopJwtPayload;
  readonly jwk: JsonWebKey;
} | {
  valid: false;
  readonly error: string;
};
