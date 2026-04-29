/**
 * DELETE /account — deletes all credentials for the signed-in user and logs
 * them out (clears the userId on the bound DPoP session).
 */

import type { RequestContext } from "@remix-run/fetch-router";

import { setNoStore } from "../middleware/auth.ts";
import { User } from "../middleware/user.ts";
import { credentialRepository } from "../lib/passkey.ts";

export const accountDeleteAction = async (
  context: RequestContext,
): Promise<Response> => {
  const user = context.get(User);
  await credentialRepository.deleteCredentialsByUserId(user.id);
  user.logout();
  return setNoStore(Response.json({ success: true }));
};
