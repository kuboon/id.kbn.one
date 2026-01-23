import { DenoKvPasskeyRepository } from "./deno-kv-passkey-store.ts";
import { DenoKvSessionRepository } from "./deno-kv-session-store.ts";
import { Secret } from "./secret.ts";
import { serveBundled } from "./serveBundled.ts";
import { getKvInstance } from "./kvInstance.ts";
import { PushService } from "./push/service.ts";
import { createPushRouter } from "./push/router.ts";
import {
  idpOrigin,
  pushContact,
  relatedOrigins,
  rpID,
  rpName,
} from "./config.ts";
import { createDpopSessionMiddleware } from "./dpop-session-middleware.ts";

import {
  createPasskeyMiddleware,
} from "../passkeys/src/hono-middleware/mod.ts";

import { type Context, Hono } from "hono";
import { serveStatic } from "hono/deno";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

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
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Sign-in required" });
  return userId;
};

const signingKey = await Secret<string>("signing_key", () => {
  return crypto.randomUUID();
}, 1000 * 60 * 60 * 24); // 1 day expiration

const app = new Hono();
const router = createPasskeyMiddleware({
  rpID,
  rpName,
  storage: credentialStore,
  secret: await signingKey.get(),
});

const dpopSessionMiddleware = createDpopSessionMiddleware({
  sessionStore,
});

app.use("*", cors({ origin: allowedOrigins }));
app.use(dpopSessionMiddleware);
app.route("/webauthn", router);

app.get("/session", (c) => {
  setNoStore(c);
  return c.json({ userId: c.get("userId") });
});

app.get("/.well-known/webauthn", (c) => {
  if (relatedOrigins.length > 0) {
    c.header("Cache-Control", "public, max-age=86400");
  }
  return c.json({ origins: relatedOrigins });
});

app.post("/session/logout", (c) => {
  setNoStore(c);
  c.set("session", {});
  return c.json({ success: true });
});

app.get("/credentials", async (c) => {
  setNoStore(c);
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Sign-in required" });
  const credentials = await credentialStore.getCredentialsByUserId(userId);
  return c.json({ userId, credentials });
});

app.delete("/credentials/:credentialId", async (c) => {
  setNoStore(c);
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Sign-in required" });
  const credentialId = c.req.param("credentialId");
  if (!credentialId) {
    throw new HTTPException(400, { message: "Missing credential identifier" });
  }
  const credential = await credentialStore.getCredentialById(credentialId);
  if (!credential || credential.userId !== userId) {
    throw new HTTPException(404, { message: "Credential not found" });
  }
  await credentialStore.deleteCredential(credentialId);
  return c.json({ success: true });
});

app.patch("/credentials/:credentialId", async (c) => {
  setNoStore(c);
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Sign-in required" });
  const credentialId = c.req.param("credentialId");
  if (!credentialId) {
    throw new HTTPException(400, { message: "Missing credential identifier" });
  }
  const body = await c.req.json<{ nickname?: string }>();
  const nickname = body.nickname?.trim();
  if (!nickname) {
    throw new HTTPException(400, { message: "nickname is required" });
  }
  const credential = await credentialStore.getCredentialById(credentialId);
  if (!credential || credential.userId !== userId) {
    throw new HTTPException(404, { message: "Credential not found" });
  }
  if (credential.nickname !== nickname) {
    credential.nickname = nickname;
    credential.updatedAt = Date.now();
    await credentialStore.updateCredential(credential);
  }
  return c.json({ credential });
});

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
  c.set("session", {});
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
function rewriteRequestPath(path: string): string {
  switch (path) {
    case "/":
      return "/index.html";
    case "/me":
      return "/me.html";
    default:
      return path;
  }
}
const staticDir = new URL("./static", import.meta.url).pathname;
app.use(
  "*",
  serveBundled({
    root: staticDir,
    entrypoints: ["index.html", "me.html"],
    replacements: {
      '"{{PASSKEY_ORIGIN}}"': JSON.stringify(idpOrigin),
    },
    rewriteRequestPath,
  }),
);
app.use("*", serveStatic({ root: staticDir, rewriteRequestPath }));

app.onError((err, c) => {
  console.error(err);
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  return c.json({ message: "Internal Server Error" }, 500);
});

export { app };
