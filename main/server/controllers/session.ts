/**
 * Session-related JSON endpoints under the `auth:` layer.
 *
 * GET /session — returns the user identifier together with RFC 7519 JWTs
 * (`id_token` and `access_token`) bound to the caller's DPoP key.
 * POST /session/logout — clears the session.
 */

import type { RequestContext } from "@remix-run/fetch-router";

import { idpOrigin } from "../config.ts";
import { signJwt } from "../lib/jwt.ts";
import { AuthRequiredError, setNoStore } from "../middleware/auth.ts";
import { DpopSession, sessionUserId } from "../middleware/dpop.ts";

const TOKEN_TTL_SECONDS = 3600;

const issueToken = async (
  userId: string,
  thumbprint: string,
) => {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_TTL_SECONDS;
  const base = {
    sub: userId,
    iss: idpOrigin,
    nbf: now,
    exp,
    cnf: { jkt: thumbprint },
  } as const;
  return await signJwt({ ...base, jti: crypto.randomUUID() });
};

export const sessionAction = async (
  context: RequestContext,
): Promise<Response> => {
  const session = context.has(DpopSession)
    ? context.get(DpopSession)
    : undefined;
  const userId = sessionUserId(session) ?? null;
  if (!userId || !session) {
    return setNoStore(Response.json({ userId: null }));
  }
  const jws = await issueToken(userId, session.thumbprint);
  return setNoStore(Response.json({ userId, jws }));
};

export const sessionLogoutAction = (context: RequestContext): Response => {
  if (!context.has(DpopSession)) {
    throw new AuthRequiredError("Invalid DPoP proof");
  }
  context.get(DpopSession).unset("userId");
  return setNoStore(Response.json({ success: true }));
};
