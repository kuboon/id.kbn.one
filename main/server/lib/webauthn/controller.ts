/**
 * Webauthn controller — wires the passkey actions to our route map. Requires
 * a verified DPoP session for `updateSession` to persist the userId.
 */

import { createPasskeysActions } from "@kuboon/passkeys/remix";

import { rpID, rpName } from "#server/config.ts";
import { credentialRepository } from "#server/lib/passkey.ts";
import { DpopSession, sessionUserId } from "#server/middleware/dpop.ts";

const actions = createPasskeysActions({
  rpID,
  rpName,
  storage: credentialRepository,
  getUserId: (context) =>
    context.has(DpopSession)
      ? sessionUserId(context.get(DpopSession))
      : undefined,
  updateSession: (context, userId) => {
    if (!context.has(DpopSession)) return;
    context.get(DpopSession).set("userId", userId);
  },
});

export const webauthnController = { actions };
