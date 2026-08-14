/**
 * /account — the signed-in user's own account.
 *
 * PATCH  /account — updates the profile (currently just `nickname`; an empty
 * string clears it).
 * DELETE /account — deletes all credentials + the profile for the signed-in
 * user and logs them out (clears the userId on the bound DPoP session).
 */

import type { UserApiContext } from "../middlewares.ts";
import { type } from "arktype";

import { User } from "../middleware/user.ts";
import { credentialRepository } from "../lib/passkey.ts";
import { deleteProfile, setNickname } from "../lib/profile.ts";

// An empty string is allowed: it clears the nickname.
const updateAccountBody = type({ nickname: "string" });

export const accountUpdateAction = async (
  context: UserApiContext,
): Promise<Response> => {
  const user = context.get(User);
  let raw: unknown;
  try {
    raw = await context.request.json();
  } catch {
    return Response.json({ message: "Invalid JSON body" }, { status: 400 });
  }
  const body = updateAccountBody(raw);
  if (body instanceof type.errors) {
    return Response.json({ message: body.summary }, { status: 400 });
  }
  const nickname = await setNickname(user.id, body.nickname);
  return Response.json({ userId: user.id, nickname }, {
    headers: { "Cache-Control": "no-store" },
  });
};

export const accountDeleteAction = async (
  context: UserApiContext,
): Promise<Response> => {
  const user = context.get(User);
  await credentialRepository.deleteCredentialsByUserId(user.id);
  await deleteProfile(user.id);
  user.logout();
  return Response.json({ success: true }, {
    headers: { "Cache-Control": "no-store" },
  });
};
