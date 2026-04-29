/**
 * Session-related JSON endpoints under the `auth:` layer.
 *
 * GET /session — returns `{ userId }` from the DPoP-bound session.
 * POST /session/logout — clears the session.
 */

import type { RequestContext } from "@remix-run/fetch-router";

import { AuthRequiredError, setNoStore } from "../middleware/auth.ts";
import { DpopSession, sessionUserId } from "../middleware/dpop.ts";

export const sessionAction = (context: RequestContext): Response => {
  const session = context.has(DpopSession)
    ? context.get(DpopSession)
    : undefined;
  return setNoStore(Response.json({ userId: sessionUserId(session) ?? null }));
};

export const sessionLogoutAction = (context: RequestContext): Response => {
  if (!context.has(DpopSession)) {
    throw new AuthRequiredError("Invalid DPoP proof");
  }
  context.get(DpopSession).unset("userId");
  return setNoStore(Response.json({ success: true }));
};
