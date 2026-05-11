/**
 * Authorization code store for the OIDC code flow.
 *
 * Codes are short-lived (RFC 6749 §10.5) and one-time-use. Consumption
 * deletes the entry atomically so a replay returns null even if the token
 * endpoint is hit twice in parallel.
 */

import { DenoKvRepo } from "@kbn/kv/denoKv.ts";
import { encodeBase64Url } from "@std/encoding/base64url";

export interface AuthorizationCodeRecord {
  client_id: string;
  redirect_uri: string;
  scope: string;
  nonce?: string;
  user_id: string;
  auth_time: number;
  code_challenge: string;
  code_challenge_method: "S256";
  exp: number;
}

const CODE_TTL_MS = 120_000;

const repo = new DenoKvRepo<AuthorizationCodeRecord>(["oidc", "code"], {
  expireIn: CODE_TTL_MS,
});

const newCode = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
};

export const issueAuthorizationCode = async (
  record: Omit<AuthorizationCodeRecord, "exp">,
): Promise<string> => {
  const code = newCode();
  const exp = Math.floor((Date.now() + CODE_TTL_MS) / 1000);
  const result = await repo.entry(code).update(() => ({ ...record, exp }));
  if (!result.ok) throw new Error("Failed to persist authorization code");
  return code;
};

/**
 * Atomically consume an authorization code: returns the record if it
 * exists and is unexpired, then deletes it. Returns null otherwise.
 */
export const consumeAuthorizationCode = async (
  code: string,
): Promise<AuthorizationCodeRecord | null> => {
  let captured: AuthorizationCodeRecord | null = null;
  const result = await repo.entry(code).update((current) => {
    captured = current;
    return null;
  });
  if (!result.ok || !captured) return null;
  const record: AuthorizationCodeRecord = captured;
  if (record.exp * 1000 < Date.now()) return null;
  return record;
};
