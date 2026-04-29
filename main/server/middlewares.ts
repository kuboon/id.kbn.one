import type { Middleware } from "@remix-run/fetch-router";
import { staticFiles } from "@remix-run/static-middleware";
import { cors } from "@remix-run/cors-middleware";

import { authorizeWhitelist, idpOrigin } from "./config.ts";
import { dpop } from "./middleware/dpop.ts";
import { AuthRequiredError } from "./middleware/auth.ts";
import { requireUser } from "./middleware/user.ts";

const allowedOrigins = (origin: string): string | undefined => {
  if (idpOrigin && origin === idpOrigin) return origin;
  for (const allowed of authorizeWhitelist) {
    if (origin === allowed || origin.endsWith("." + allowed)) {
      return origin;
    }
  }
  return undefined;
};

const bundledDir = new URL("../bundled", import.meta.url).pathname;

const errorHandler: Middleware = async (_context, next) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof AuthRequiredError) return error.response;
    if (error instanceof Response) return error;
    console.error(error);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
};

export const middleware = [
  errorHandler,
  staticFiles(bundledDir),
];

/**
 * `auth:` layer — passkey auth flow + raw session inspection. Verifies DPoP
 * and exposes `DpopSession` directly.
 */
export const authMiddleware = [dpop] as const;

/**
 * `userApi:` layer — routes that require a signed-in user. The DPoP proof
 * is verified and the `User` entry is set; `requireUser` 401s when no user
 * is bound. Handlers should consume `context.get(User)`, not `DpopSession`.
 */
export const userApiMiddleware = [dpop, requireUser] as const;

const corsMiddleware = cors({
  origin: (origin) => allowedOrigins(origin) ?? false,
  credentials: true,
  allowedHeaders: ["content-type", "dpop", "authorization"],
});

export const corsMiddlewares = [dpop, requireUser, corsMiddleware] as const;
