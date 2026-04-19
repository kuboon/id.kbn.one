/**
 * The subset of the DPoP proof JWT payload members defined in
 * [RFC 9449 §4.2](https://www.rfc-editor.org/rfc/rfc9449#section-4.2).
 *
 * Only the four mandatory fields are validated by this library; `nonce` and
 * `ath` are surfaced when present so callers can implement the nonce challenge
 * flow or access-token binding themselves.
 */
export interface DpopJwtPayload {
  /** HTTP method of the request the proof is bound to (e.g. `"POST"`). */
  readonly htm: string;
  /** HTTP target URI of the request, without fragment. */
  readonly htu: string;
  /** Unique identifier for the proof — used for replay detection. */
  readonly jti: string;
  /** Issued-at time in seconds since the Unix epoch. */
  readonly iat: number;
  /** Optional DPoP nonce returned by the server on a prior 401. */
  readonly nonce?: string;
  /**
   * Optional SHA-256 hash of the associated access token (base64url-encoded),
   * used when the proof accompanies a DPoP-bound access token.
   */
  readonly ath?: string;
}

/**
 * Access-token binding assertion for {@link VerifyDpopProofOptions.accessToken}.
 *
 * The caller is responsible for verifying the access token itself (signature,
 * `iss`, `aud`, `exp` — typically via `jose.jwtVerify`). Passing the raw token
 * string plus the decoded `cnf.jkt` lets this library complete the
 * [RFC 9449 §7](https://www.rfc-editor.org/rfc/rfc9449#section-7) binding
 * checks: the proof's JWK thumbprint must equal `cnf.jkt`, and the proof's
 * `ath` claim must equal `SHA-256(token)`.
 */
export interface DpopAccessTokenBinding {
  /** The raw access-token string carried in `Authorization: DPoP <token>`. */
  readonly token: string;
  /**
   * Decoded access-token claims — only `cnf.jkt` is read by this library.
   * Additional fields (e.g. `sub`, `iss`, `aud`) are allowed and ignored.
   */
  readonly claims: {
    readonly cnf?: { readonly jkt?: string };
    readonly [key: string]: unknown;
  };
}

/** Options accepted by {@link verifyDpopProof} and {@link verifyDpopProofFromRequest}. */
export interface VerifyDpopProofOptions {
  /** Maximum allowed age (seconds) for the `iat` claim. Defaults to 300s. */
  readonly maxAgeSeconds?: number;
  /**
   * Allowed clock skew (seconds) when comparing the `iat` claim with the
   * current time. Defaults to 60s.
   */
  readonly clockSkewSeconds?: number;
  /**
   * Hook to reject replayed `jti` values. Return `false` to reject, `true` to
   * accept. Defaults to accepting every `jti` — provide your own implementation
   * in production to make DPoP proofs one-shot.
   */
  readonly checkReplay?: (jti: string) => boolean | Promise<boolean>;
  /**
   * Allows providing a custom timestamp (in seconds) for deterministic tests.
   * Defaults to `Math.floor(Date.now() / 1000)`.
   */
  readonly now?: number;
  /**
   * When provided, additionally verifies that the DPoP proof is bound to this
   * pre-verified access token (RFC 9449 §7). Fails with `jkt-mismatch` or
   * `ath-mismatch` on violation.
   */
  readonly accessToken?: DpopAccessTokenBinding;
}
