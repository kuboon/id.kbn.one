import type { SessionData, SessionRepository } from "./repository/types.ts";

import type { VerifyDpopProofOptions } from "@scope/dpop/types.ts";
import { verifyDpopProofFromRequest } from "@scope/dpop";

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
    Variables: { session?: SessionData; sessionKey?: string };
  }>(
    async (c, next) => {
      const dpop = await verifyDpopProofFromRequest(c.req.raw, dpopOptions);
      if (!dpop.valid) {
        return next();
      }

      const sessionKey = dpop.parts[0];
      c.set("sessionKey", sessionKey);
      const beforeSession = await sessionStore.get(sessionKey);
      c.set("session", beforeSession);
      await next();
      const afterSession = c.get("session");
      if (!equal(afterSession, beforeSession)) {
        await sessionStore.update(sessionKey, () => afterSession ?? null);
      }
    },
  );
};
