import type { SessionData, SessionRepository } from "./repository/types.ts";

import type { VerifyDpopProofOptions } from "@kuboon/dpop/types.ts";
import { verifyDpopProofFromRequest } from "@kuboon/dpop";
import { computeThumbprint } from "@kuboon/dpop/common.ts";

import { createMiddleware } from "hono/factory";
import { equal } from "@std/assert";

export interface DpopSessionMiddlewareOptions extends VerifyDpopProofOptions {
  sessionStore: SessionRepository;
}

export const createDpopSessionMiddleware = (
  options: DpopSessionMiddlewareOptions,
) => {
  const { sessionStore, ...dpopOptions } = options;

  return createMiddleware<{
    Variables: { session?: SessionData; thumbprint?: string };
  }>(
    async (c, next) => {
      // dpopOptions contains mandatory checkReplay
      const dpop = await verifyDpopProofFromRequest(c.req.raw, dpopOptions);
      if (!dpop.valid) {
        return next();
      }

      const thumbprint = await computeThumbprint(dpop.jwk);
      c.set("thumbprint", thumbprint);
      const beforeSession = await sessionStore.get(thumbprint);
      c.set("session", beforeSession);
      await next();
      const afterSession = c.get("session");
      if (!equal(afterSession, beforeSession)) {
        await sessionStore.update(thumbprint, () => afterSession ?? null);
      }
    },
  );
};
