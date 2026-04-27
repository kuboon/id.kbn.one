/**
 * Webauthn controller — wires the passkey actions to our route map. Requires
 * a verified DPoP session for `updateSession` to persist the userId.
 */

import { createPasskeysActions } from "@kuboon/passkeys/fetch-router-middleware";

import { rpID, rpName } from "../config.ts";
import { credentialRepository } from "../repositories.ts";
import { DpopSession, sessionUserId } from "../middleware/dpop.ts";

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
