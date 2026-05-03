/**
 * Reference app server — Remix v3 fetch-router + DPoP session middleware.
 *
 * Three layers:
 *   - root: errorHandler / cors / staticFiles, applied to every route
 *   - auth: dpop. Passkey + raw session ops; touches DpopSession directly.
 *   - userApi: dpop + requireUser. Routes consume `context.get(User)` only.
 */

import { createRouter } from "@remix-run/fetch-router";

import { accountDeleteAction } from "./controllers/account.ts";
import { authorizeAction } from "./controllers/authorize.tsx";
import { bindSessionAction } from "./controllers/bind-session.ts";
import { credentialsController } from "./controllers/credentials.ts";
import { homeAction } from "./controllers/home.tsx";
import { jwksAction } from "./controllers/jwks.ts";
import { meAction } from "./controllers/me.tsx";
import { pushController } from "./controllers/push.ts";
import { sessionAction, sessionLogoutAction } from "./controllers/session.ts";
import { webauthnController } from "./lib/webauthn/controller.ts";
import { routes } from "./routes.ts";
import {
  authMiddleware,
  corsMiddlewares,
  middleware,
  userApiMiddleware,
} from "#server/middlewares.ts";

const router = createRouter({ middleware });

// HTML pages — root middleware only.
router.get(routes.home, homeAction);
router.get(routes.me, meAction);
router.get(routes.authorize, authorizeAction);
router.get(routes.jwks, jwksAction);

// auth: layer — DPoP-bound passkey + raw session ops.
router.map(routes.auth, {
  middleware: authMiddleware,
  actions: {
    webauthn: webauthnController,
  },
});

// userApi: layer — authenticated user APIs (User in context).
router.map(routes.userApi, {
  middleware: userApiMiddleware,
  actions: {
    bindSession: bindSessionAction,
    accountDelete: accountDeleteAction,
    credentials: credentialsController,
    push: pushController,
  },
});

router.map(routes.cors, {
  middleware: corsMiddlewares,
  actions: {
    session: sessionAction,
    sessionLogout: sessionLogoutAction,
  },
});

export default router;
