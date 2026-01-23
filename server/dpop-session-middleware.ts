import type { MiddlewareHandler } from "hono/types";
import { createDpopMiddleware } from "../dpop/hono-middleware.ts";
import type { DpopMiddlewareOptions } from "../dpop/hono-middleware.ts";
import type {
  DenoKvSessionStore,
  SessionData,
} from "./deno-kv-session-store.ts";
import { equal } from "@std/assert";

declare module "hono" {
  interface ContextVariableMap {
    session?: SessionData;
  }
}

export interface DpopSessionMiddlewareOptions extends DpopMiddlewareOptions {
  sessionStore: DenoKvSessionStore;
}

export const createDpopSessionMiddleware = (
  options: DpopSessionMiddlewareOptions,
): MiddlewareHandler => {
  const { sessionStore, ...dpopOptions } = options;
  const dpopMiddleware = createDpopMiddleware(dpopOptions);

  return async (c, next) => {
    await dpopMiddleware(c, async () => {
      const dpop = c.get("dpop");
      let sessionKey: string | undefined;

      if (dpop?.valid) {
        const proof = c.req.header("DPoP");
        if (proof) {
          sessionKey = proof.split(".")[0];
          const sessionData = await sessionStore.get(sessionKey);
          if (sessionData) {
            c.set("session", sessionData);
          }
        }
      }

      const beforeSession = c.get("session");
      await next();
      const afterSession = c.get("session");

      if (sessionKey && !equal(afterSession, beforeSession)) {
        if (afterSession) {
          await sessionStore.set(sessionKey, afterSession);
        } else {
          await sessionStore.delete(sessionKey);
        }
      }
    });
  };
};
