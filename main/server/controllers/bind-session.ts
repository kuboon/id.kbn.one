/**
 * POST /bind_session — binds the signed-in userId to another DPoP key
 * (RP -> IdP flow). Lives in the `userApi:` layer because it requires a
 * logged-in user.
 */

import type { RequestContext } from "@remix-run/fetch-router";
import { type } from "arktype";

import { setNoStore } from "../middleware/auth.ts";
import { User } from "../middleware/user.ts";
import { sessionRepository } from "../lib/session.ts";

const bindSessionBody = type({
  dpop_jkt: /^[A-Za-z0-9_-]{43}$/,
});

export const bindSessionAction = async (
  context: RequestContext,
): Promise<Response> => {
  const { id: userId } = context.get(User);
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
