import { DenoKvPasskeyRepository } from "./repository/deno-kv-passkey-store.ts";
import { DenoKvSessionRepository } from "./repository/deno-kv-session-store.ts";
import { Secret } from "./secret.ts";
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
import { SessionData } from "./repository/types.ts";

const kv = await getKvInstance();
const credentialStore = new DenoKvPasskeyRepository(kv);
const sessionStore = new DenoKvSessionRepository(kv);
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

const signingKey = await Secret<string>("signing_key", () => {
  return crypto.randomUUID();
}, 1000 * 60 * 60 * 24); // 1 day expiration

const app = new Hono<{ Variables: { session?: SessionData } }>();
const router = createPasskeysRouter({
  rpID,
  rpName,
  storage: credentialStore,
  secret: await signingKey.get(),
  getUserId: (c) => c.var.session?.userId,
});

const dpopSessionMiddleware = createDpopSessionMiddleware({
  sessionStore,
});

app.use("*", cors({ origin: allowedOrigins }));
app.use(dpopSessionMiddleware);
app.route("/webauthn", router);

app.get("/session", (c) => {
  setNoStore(c);
  return c.json({ userId: c.var.session?.userId || null });
});

app.get("/.well-known/webauthn", (c) => {
  if (relatedOrigins.length > 0) {
    c.header("Cache-Control", "public, max-age=86400");
  }
  return c.json({ origins: relatedOrigins });
});

app.post("/session/logout", (c) => {
  setNoStore(c);
  c.set("session", undefined);
  return c.json({ success: true });
});

app.route(
  "/credentials",
  createCredentialsRouter({
    credentialStore,
    ensureAuthenticatedUser,
    setNoStore,
  }),
);

app.delete("/account", async (c) => {
  setNoStore(c);
  const userId = ensureAuthenticatedUser(c);
  if (typeof credentialStore.deleteUser !== "function") {
    throw new HTTPException(405, {
      message: "Account deletion is not supported by this storage adapter.",
    });
  }
  if (typeof credentialStore.deleteCredential === "function") {
    const credentials = await credentialStore.getCredentialsByUserId(userId);
    for (const credential of credentials) {
      await credentialStore.deleteCredential(credential.id);
    }
  }
  await credentialStore.deleteUser(userId);
  c.set("session", undefined);
  return c.json({ success: true });
});

app.route(
  "/push",
  createPushRouter({
    pushService,
    pushContact,
    ensureAuthenticatedUser,
    setNoStore,
  }),
);

export { app };
