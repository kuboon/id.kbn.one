import type { DpopJwtPayload } from "../types.ts";

/** The HTTP method + URL a DPoP proof is bound to. */
export interface DpopHttpRequest {
  /** HTTP method of the bound request (case-insensitive). */
  readonly method: string;
  /** Full request URL, including scheme, host, path and search. */
  readonly url: string;
}

/** Input for {@link verifyDpopProof}: an HTTP request plus the DPoP proof. */
export interface DpopProofRequest extends DpopHttpRequest {
  /** The raw `DPoP` header value (compact-serialized JWT). */
  readonly proof: string;
}

/** Input for helpers that create a DPoP proof for a given request. */
export interface CreateDpopProofRequest extends DpopHttpRequest {
  /** The ECDSA P-256 key pair used to sign the proof. */
  readonly keyPair: CryptoKeyPair;
}

/**
 * Discriminated union returned by {@link verifyDpopProof}.
 *
 * On success, all inspected pieces of the proof are exposed so callers can
 * perform further policy checks (e.g. compare `jwk` against a bound session
 * thumbprint, enforce a `nonce`, verify `ath` against an access token).
 *
 * On failure, `error` is a short, machine-readable code — see the README for
 * the exhaustive list.
 */
export type VerifyDpopProofResult = {
  valid: true;
  /** The three base64url segments of the JWT (`header.payload.signature`). */
  readonly parts: readonly [string, string, string];
  /** The decoded payload — signature already verified. */
  readonly payload: DpopJwtPayload;
  /** The public JWK extracted from the proof header. */
  readonly jwk: JsonWebKey;
  readonly error?: undefined;
} | {
  valid: false;
  /** Short code describing why verification failed. */
  readonly error: string;
};
