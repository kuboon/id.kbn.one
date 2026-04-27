/**
 * Reference app server — Remix v3 fetch-router + DPoP session middleware.
 */

import { createRouter } from "@remix-run/fetch-router";
import { staticFiles } from "@remix-run/static-middleware";
import { cors } from "@remix-run/cors-middleware";

import { authorizeWhitelist, idpOrigin } from "./config.ts";
import { dpop } from "./middleware/dpop.ts";
import { AuthRequiredError } from "./middleware/auth.ts";

import { accountDeleteAction } from "./controllers/account.ts";
import { authorizeAction } from "./controllers/authorize.tsx";
import { credentialsController } from "./controllers/credentials.ts";
import { homeAction } from "./controllers/home.tsx";
import { meAction } from "./controllers/me.tsx";
import { pushController } from "./controllers/push.ts";
import {
  bindSessionAction,
  sessionAction,
  sessionLogoutAction,
} from "./controllers/session.ts";
import { webauthnController } from "./controllers/webauthn.ts";
import { routes } from "./routes.ts";

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

const errorHandler = async (
  _context: { request: Request },
  next: () => Promise<Response>,
): Promise<Response> => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof AuthRequiredError) return error.response;
    if (error instanceof Response) return error;
    console.error(error);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
};

const router = createRouter({
  middleware: [
    errorHandler,
    cors({
      origin: (origin) => allowedOrigins(origin) ?? false,
      credentials: true,
      allowedHeaders: ["content-type", "dpop", "authorization"],
    }),
    staticFiles(bundledDir),
    dpop,
  ],
});

// deno-lint-ignore no-explicit-any
const r = router as any;

// Pages
r.get(routes.home, homeAction);
r.get(routes.me, meAction);
r.get(routes.authorize, authorizeAction);

// Session
r.get(routes.session, sessionAction);
r.post(routes.sessionLogout, sessionLogoutAction);
r.post(routes.bindSession, bindSessionAction);

// Account
r.delete(routes.accountDelete, accountDeleteAction);

// Sub-routers
r.map(routes.webauthn, webauthnController);
r.map(routes.credentials, credentialsController);
r.map(routes.push, pushController);

export default router;
