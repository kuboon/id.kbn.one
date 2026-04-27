/**
 * DELETE /account — deletes all credentials for the signed-in user and
 * unsets the userId on the DPoP session.
 */

import type { RequestHandler } from "@remix-run/fetch-router";

import { credentialRepository } from "../repositories.ts";
import { DpopSession } from "../middleware/dpop.ts";
import { requireUser, setNoStore } from "../middleware/auth.ts";

export const accountDeleteAction: RequestHandler = async (context) => {
  const { userId } = requireUser(context);
  await credentialRepository.deleteCredentialsByUserId(userId);
  if (context.has(DpopSession)) {
    context.get(DpopSession).unset("userId");
  }
  return setNoStore(Response.json({ success: true }));
};
