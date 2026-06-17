/**
 * Verify a `private_key_jwt` client assertion (RFC 7521 §4.2 / RFC 7523) from
 * an RP server.
 *
 * The assertion is a compact JWS the RP signs with its **private** key:
 *
 * - `typ` header: `client-assertion+jwt` (guards against token confusion)
 * - `alg`: `ES256`, with a `kid` selecting the registered public key
 * - `iss` and `sub`: the RP's `clientId`
 * - `aud`: the IdP origin (so an assertion can't be replayed at another host)
 * - `exp`, `iat`, `jti`: short-lived and single-use (replay-protected)
 */

import { decodeJwt, jwtVerify } from "jose";

import { idpOrigin } from "../../config.ts";
import { DenoKvJtiStore } from "../../repository/deno-kv-jti-store.ts";
import { getKvInstance } from "../../kvInstance.ts";
import { type RpClientRegistry, rpClientRegistry } from "./clients.ts";

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
  /** Client registry to resolve keys from. Defaults to the env-derived one. */
  registry?: RpClientRegistry;
  /** Replay detector. Defaults to the shared KV-backed JTI store. */
  replay?: ReplayCheck;
}

/**
 * Verify a client assertion and return the authenticated `clientId`.
 *
 * @throws {ClientAssertionError} when the assertion is malformed, signed by an
 * unregistered/unknown client, fails signature/claim validation, or replays a
 * previously seen `jti`.
 */
export const verifyClientAssertion = async (
  assertion: string,
  opts: VerifyClientAssertionOptions = {},
): Promise<{ clientId: string }> => {
  const registry = opts.registry ?? rpClientRegistry();
  const audience = opts.audience ?? idpOrigin;
  const replay = opts.replay ?? getDefaultReplay();

  // Read the unverified `iss` only to select which registered key to verify
  // against — the signature check below still requires that client's key.
  let issuer: string | undefined;
  try {
    issuer = decodeJwt(assertion).iss;
  } catch {
    throw new ClientAssertionError("Malformed client assertion");
  }
  if (!issuer) {
    throw new ClientAssertionError("Client assertion is missing iss");
  }

  const client = registry.get(issuer);
  if (!client) {
    throw new ClientAssertionError(`Unknown client: ${issuer}`);
  }

  let payload: { jti?: string };
  try {
    ({ payload } = await jwtVerify(assertion, client.keys, {
      issuer: client.clientId,
      subject: client.clientId,
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

  return { clientId: client.clientId };
};
