import type { Middleware, MiddlewareContext } from "@remix-run/fetch-router";
import { staticFiles } from "@remix-run/static-middleware";
import { cors } from "@remix-run/cors-middleware";

import { idpOrigin, originAllowlist } from "./config.ts";
import { dpop } from "./middleware/dpop.ts";
import { AuthRequiredError } from "./middleware/auth.ts";
import { requireUser } from "./middleware/user.ts";
import { requireRpClient } from "./middleware/rp.ts";

const allowedOrigins = (origin: string): string | undefined => {
  if (idpOrigin && origin === idpOrigin) return origin;
  return originAllowlist.originAllowed(origin) ? origin : undefined;
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
  // Every RP call carries a `DPoP` header, which is not CORS-safelisted, so
  // the browser preflights it. Without a Max-Age it falls back to the browser
  // default (5s in Chrome) and re-preflights on essentially every page load —
  // a whole extra cross-origin round trip before the RP can even ask who the
  // user is. 2h is Chrome's cap; other browsers clamp to their own maximum.
  maxAge: 7200,
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

/**
 * `rpApi:` layer — server-to-server callers. `requireRpClient` verifies the
 * `private_key_jwt` client assertion and exposes `RpClient`; there is no DPoP
 * or browser session here.
 */
export const rpApiMiddleware = [requireRpClient] as const;

/**
 * Request-context types produced by each layer's middleware chain.
 *
 * `context.get(key)` only narrows to a non-optional value when the context
 * type carries the entry the middleware declared, so handlers annotate their
 * `context` with the type of the layer they are mounted under — e.g. a
 * `userApi:` handler takes {@link UserApiContext} and gets a `User` back from
 * `context.get(User)` rather than `User | undefined`.
 */
export type AuthContext = MiddlewareContext<typeof authMiddleware>;
export type UserApiContext = MiddlewareContext<typeof userApiMiddleware>;
export type CorsContext = MiddlewareContext<typeof corsMiddlewares>;
export type RpApiContext = MiddlewareContext<typeof rpApiMiddleware>;
