import { DenoKvPasskeyRepository } from "./repository/deno-kv-passkey-store.ts";
import { DenoKvSessionRepository } from "./repository/deno-kv-session-store.ts";
import { getKvInstance } from "./kvInstance.ts";
import { PushService } from "./push/service.ts";
import { createPushRouter } from "./push/router.ts";
import { createCredentialsRouter } from "./credentials/router.ts";
import {
  idpOrigin,
  pushContact,
  relatedOrigins,
  rpID,
  rpName,
} from "./config.ts";
import { createDpopSessionMiddleware } from "./dpop-session-middleware.ts";

import { createPasskeysRouter } from "@scope/passkeys/hono-middleware";

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

const kv = await getKvInstance();
const credentialRepository = new DenoKvPasskeyRepository(kv);
const sessionRepository = new DenoKvSessionRepository(kv);
const pushService = await PushService.create(kv);

const allowedOrigins = [
  ...(idpOrigin ? [idpOrigin] : []),
  ...relatedOrigins,
];

const setNoStore = (c: Context) => {
  c.header("Cache-Control", "no-store");
};

const ensureAuthenticatedUser = (c: Context): string => {
  const userId = c.var.session?.userId;
  if (!userId) throw new HTTPException(401, { message: "Sign-in required" });
  return userId;
};

const app = new Hono()
  .use(cors({ origin: allowedOrigins }))
  .use(createDpopSessionMiddleware({
    sessionStore: sessionRepository,
  }))
  .post("/session/logout", (c) => {
    setNoStore(c);
    c.set("session", undefined);
    return c.json({ success: true });
  })
  .use((c, next) => {
    const acceptsJson = c.req.header("accept")?.includes(
      "application/json",
    );
    if (acceptsJson && !c.var.sessionKey) {
      throw new HTTPException(401, { message: "Invalid DPoP proof" });
    }
    return next();
  })
  .route(
    "/webauthn",
    createPasskeysRouter({
      rpID,
      rpName,
      storage: credentialRepository,
      getUserId: (c) => c.var.session?.userId,
    }),
  )
  .get("/.well-known/webauthn", (c) => {
    if (relatedOrigins.length > 0) {
      c.header("Cache-Control", "public, max-age=86400");
    }
    return c.json({ origins: relatedOrigins });
  })
  .get("/session", (c) => {
    return c.json({ userId: c.var.session?.userId || null });
  })
  .route(
    "/credentials",
    createCredentialsRouter({
      credentialStore: credentialRepository,
      ensureAuthenticatedUser,
      setNoStore,
    }),
  )
  .delete("/account", async (c) => {
    setNoStore(c);
    const userId = ensureAuthenticatedUser(c);
    await credentialRepository.deleteCredentialsByUserId(userId);
    c.set("session", undefined);
    return c.json({ success: true });
  })
  .route(
    "/push",
    createPushRouter({
      pushService,
      pushContact,
      ensureAuthenticatedUser,
      setNoStore,
    }),
  );

export { app };
