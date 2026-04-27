/**
 * Session-related JSON endpoints.
 *
 * GET /session — returns `{ userId }` from the DPoP-bound session.
 * POST /session/logout — clears the session.
 * POST /bind_session — binds a userId to another DPoP key (RP -> IdP flow).
 */

import type { RequestHandler } from "@remix-run/fetch-router";
import { type } from "arktype";

import { authorizeWhitelist } from "../config.ts";
import { DpopSession, sessionUserId } from "../middleware/dpop.ts";
import {
  requireDpopSession,
  requireUser,
  setNoStore,
} from "../middleware/auth.ts";
import { sessionRepository } from "../repositories.ts";

export const sessionAction: RequestHandler = (context) => {
  const session = context.has(DpopSession)
    ? context.get(DpopSession)
    : undefined;
  return setNoStore(Response.json({ userId: sessionUserId(session) ?? null }));
};

export const sessionLogoutAction: RequestHandler = (context) => {
  const session = requireDpopSession(context);
  session.unset("userId");
  return setNoStore(Response.json({ success: true }));
};

const bindSessionBody = type({
  dpop_jkt: /^[A-Za-z0-9_-]{43}$/,
});

export const bindSessionAction: RequestHandler = async (context) => {
  const { userId } = requireUser(context);
  let raw: unknown;
  try {
    raw = await context.request.json();
  } catch {
    return Response.json({ message: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bindSessionBody(raw);
  if (parsed instanceof type.errors) {
    return Response.json({ message: parsed.summary }, { status: 400 });
  }
  await sessionRepository.update(parsed.dpop_jkt, () => ({ userId }));
  return setNoStore(Response.json({ success: true }));
};

export { authorizeWhitelist };
