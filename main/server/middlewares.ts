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

const corsMiddleware = cors({
  origin: (origin) => allowedOrigins(origin) ?? false,
  credentials: true,
  allowedHeaders: ["content-type", "dpop", "authorization"],
});

/**
 * Root-level middleware applied to every request.
 *
 * `corsMiddleware` runs here (not inside a route group) so that OPTIONS
 * preflights — which never match a method-specific route and therefore
 * skip route-scoped middleware — still get a proper 204 with CORS
 * headers.
 */
export const middleware = [
  errorHandler,
  corsMiddleware,
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

/**
 * `cors:` layer — userApi semantics for cross-origin callers. The CORS
 * middleware itself is in the root chain (above) so preflights resolve
 * before routing; this layer just adds DPoP + requireUser.
 */
export const corsMiddlewares = [dpop, requireUser] as const;
