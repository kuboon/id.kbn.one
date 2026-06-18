/**
 * Verify a `private_key_jwt` client assertion (RFC 7521 §4.2 / RFC 7523) from
 * an RP server.
 *
 * The assertion is a compact JWS the RP signs with its **private** key:
 *
 * - `typ` header: `client-assertion+jwt` (guards against token confusion)
 * - `alg`: `ES256`, with a `kid` selecting one of the RP's published keys
 * - `iss` and `sub`: the RP's `clientId` (= its origin, must be whitelisted)
 * - `aud`: the IdP origin (so an assertion can't be replayed at another host)
 * - `exp`, `iat`, `jti`: short-lived and single-use (replay-protected)
 *
 * The RP's public key is taken from its own JWKS (`isAllowedRpClient` /
 * `rpKeySet`), so there is no separate key registry on the IdP.
 */

import { decodeJwt, jwtVerify, type JWTVerifyGetKey } from "jose";

import { idpOrigin } from "../../config.ts";
import { DenoKvJtiStore } from "../../repository/deno-kv-jti-store.ts";
import { getKvInstance } from "../../kvInstance.ts";
import { isAllowedRpClient, rpKeySet } from "./clients.ts";

export const CLIENT_ASSERTION_TYP = "client-assertion+jwt";

export class ClientAssertionError extends Error {}

/** Replay guard: returns true when `jti` is new, false when already seen. */
export type ReplayCheck = (jti: string) => Promise<boolean>;

let defaultReplay: ReplayCheck | undefined;
const getDefaultReplay = (): ReplayCheck => {
  if (!defaultReplay) {
    const store = getKvInstance().then((kv) => new DenoKvJtiStore(kv));
    defaultReplay = async (jti) => await (await store).checkReplay(jti);
  }
  return defaultReplay;
};

export interface VerifyClientAssertionOptions {
  /** Expected `aud`. Defaults to the IdP origin. */
  audience?: string;
  /** Whether `clientId` is an allowed RP. Defaults to the whitelist check. */
  isAllowed?: (clientId: string) => boolean;
  /** Resolve the RP's verification key(s). Defaults to the RP's remote JWKS. */
  keysFor?: (clientId: string) => JWTVerifyGetKey;
  /** Replay detector. Defaults to the shared KV-backed JTI store. */
  replay?: ReplayCheck;
}

/**
 * Verify a client assertion and return the authenticated `clientId`.
 *
 * @throws {ClientAssertionError} when the assertion is malformed, comes from a
 * non-whitelisted client, fails signature/claim validation, or replays a
 * previously seen `jti`.
 */
export const verifyClientAssertion = async (
  assertion: string,
  opts: VerifyClientAssertionOptions = {},
): Promise<{ clientId: string }> => {
  const audience = opts.audience ?? idpOrigin;
  const isAllowed = opts.isAllowed ?? isAllowedRpClient;
  const keysFor = opts.keysFor ?? rpKeySet;
  const replay = opts.replay ?? getDefaultReplay();

  // Read the unverified `iss` only to pick the client — the signature check
  // below still requires that client's key.
  let issuer: string | undefined;
  try {
    issuer = decodeJwt(assertion).iss;
  } catch {
    throw new ClientAssertionError("Malformed client assertion");
  }
  if (!issuer) {
    throw new ClientAssertionError("Client assertion is missing iss");
  }
  if (!isAllowed(issuer)) {
    throw new ClientAssertionError(`Unauthorized client: ${issuer}`);
  }

  let keys: JWTVerifyGetKey;
  try {
    keys = keysFor(issuer);
  } catch {
    throw new ClientAssertionError(`Invalid client origin: ${issuer}`);
  }

  let payload: { jti?: string };
  try {
    ({ payload } = await jwtVerify(assertion, keys, {
      issuer,
      subject: issuer,
      audience,
      algorithms: ["ES256"],
      typ: CLIENT_ASSERTION_TYP,
      requiredClaims: ["jti", "exp"],
    }));
  } catch (error) {
    throw new ClientAssertionError(
      error instanceof Error ? error.message : "Invalid client assertion",
    );
  }

  const jti = payload.jti;
  if (typeof jti !== "string" || !jti) {
    throw new ClientAssertionError("Client assertion is missing jti");
  }
  if (!(await replay(jti))) {
    throw new ClientAssertionError("Client assertion replayed");
  }

  return { clientId: issuer };
};
