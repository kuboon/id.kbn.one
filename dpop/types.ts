export interface DpopJwtPayload {
  readonly htm: string;
  readonly htu: string;
  readonly jti: string;
  readonly iat: number;
  readonly nonce?: string;
  readonly ath?: string;
}
export interface VerifyDpopProofOptions {
  /** Maximum allowed age (seconds) for the `iat` claim. Defaults to 300s. */
  readonly maxAgeSeconds?: number;
  /**
   * Allowed clock skew (seconds) when comparing the `iat` claim with the
   * current time. Defaults to 60s.
   */
  readonly clockSkewSeconds?: number;
  /** Optional hook to reject replayed `jti` values. */
  readonly checkReplay?: (jti: string) => boolean | Promise<boolean>;
  /**
   * Allows providing a custom timestamp (in seconds) for deterministic tests.
   * Defaults to `Math.floor(Date.now() / 1000)`.
   */
  readonly now?: number;
}
