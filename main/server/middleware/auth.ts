/**
 * Auth helpers: extract the signed-in userId from the DPoP session, throwing
 * a 401 Response when missing.
 */

import type { RequestContext } from "@remix-run/fetch-router";
import { DpopSession, sessionUserId } from "./dpop.ts";

export class AuthRequiredError extends Error {
  readonly response: Response;
  constructor(message = "Sign-in required") {
    super(message);
    this.response = Response.json({ message }, { status: 401 });
  }
}

export const requireDpopSession = (context: RequestContext): DpopSession => {
  const session = context.has(DpopSession)
    ? context.get(DpopSession)
    : undefined;
  if (!session) {
    throw new AuthRequiredError("Invalid DPoP proof");
  }
  return session;
};

export const requireUser = (context: RequestContext): {
  session: DpopSession;
  userId: string;
} => {
  const session = requireDpopSession(context);
  const userId = sessionUserId(session);
  if (!userId) throw new AuthRequiredError();
  return { session, userId };
};

export const setNoStore = (response: Response): Response => {
  response.headers.set("cache-control", "no-store");
  return response;
};
