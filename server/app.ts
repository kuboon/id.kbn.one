import { DenoKvPasskeyStore } from "./deno-kv-passkey-store.ts";
import { PushService } from "./push/service.ts";
import { getKvInstance } from "./kvInstance.ts";
import { createPushRouter } from "./push/router.ts";
import {
  idpOrigin,
  pushContact,
  relatedOrigins,
  rpID,
  rpName,
} from "./config.ts";
import {
  createPasskeyMiddleware,
  type PasskeyUser,
  SESSION_COOKIE_NAME,
} from "@scope/hono-passkeys-middleware";

import { type Context, Hono } from "hono";
import { serveStatic } from "hono/deno";
import { cors } from "hono/cors";
import { deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { Secret } from "./secret.ts";
import { serveBundled } from "./serveBundled.ts";

const kv = await getKvInstance();
const credentialStore = new DenoKvPasskeyStore(kv);
const pushService = await PushService.create(kv);

const allowedOrigins = [
  ...(idpOrigin ? [idpOrigin] : []),
  ...relatedOrigins,
];

const setNoStore = (c: Context) => {
  c.header("Cache-Control", "no-store");
};

const ensureAuthenticatedUser = (c: Context): PasskeyUser => {
  const user = c.get("user");
  if (!user) throw new HTTPException(401, { message: "Sign-in required" });
  return user;
};

type AccountUpdatePayload = {
  username?: string;
};

const parseAccountUpdate = async (
  c: Context,
): Promise<AccountUpdatePayload> => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON payload" });
  }

  if (!body || typeof body !== "object") {
    throw new HTTPException(400, { message: "Invalid request body" });
  }

  const { username } = body as { username?: unknown };
  if (username === undefined) {
    return {};
  }
  if (typeof username !== "string" || !username.trim()) {
    throw new HTTPException(400, { message: "Username cannot be empty" });
  }

  return { username: username.trim() };
};

const signingKey = await Secret<string>("signing_key", () => {
  const key = crypto.randomUUID();
  console.info(`Generated new signing key: ${key}`);
  return key;
}, 60 * 60 * 24); // 1 day expiration

const app = new Hono();
const { router, middleware } = createPasskeyMiddleware({
  rpID,
  rpName,
  storage: credentialStore,
  secret: await signingKey.get(),
});

app.use("*", cors({ origin: allowedOrigins }));
app.use(middleware);
app.route("/webauthn", router);

app.get("/session", (c) => {
  setNoStore(c);
  return c.json({ user: c.get("user") });
});

app.get("/.well-known/webauthn", (c) => {
  if (relatedOrigins.length > 0) {
    c.header("Cache-Control", "public, max-age=86400");
  }
  return c.json({ origins: relatedOrigins });
});

app.post("/session/logout", (c) => {
  setNoStore(c);
  deleteCookie(c, SESSION_COOKIE_NAME);
  return c.json({ success: true });
});

app.patch("/account", async (c) => {
  setNoStore(c);
  const currentUser = ensureAuthenticatedUser(c);
  const { username } = await parseAccountUpdate(c);

  if (username === undefined) {
    return c.json({ user: currentUser });
  }

  if (username.toLowerCase() === currentUser.username.toLowerCase()) {
    return c.json({ user: currentUser });
  }

  const existing = await credentialStore.getUserByUsername(username);
  if (existing && existing.id !== currentUser.id) {
    throw new HTTPException(409, {
      message: "That username is already taken.",
    });
  }

  const updatedUser: PasskeyUser = { ...currentUser, username };
  await credentialStore.updateUser(updatedUser);
  return c.json({ user: updatedUser });
});

app.delete("/account", async (c) => {
  setNoStore(c);
  const user = await ensureAuthenticatedUser(c);
  if (typeof credentialStore.deleteUser !== "function") {
    throw new HTTPException(405, {
      message: "Account deletion is not supported by this storage adapter.",
    });
  }
  if (typeof credentialStore.deleteCredential === "function") {
    const credentials = await credentialStore.getCredentialsByUserId(user.id);
    for (const credential of credentials) {
      await credentialStore.deleteCredential(credential.id);
    }
  }
  await credentialStore.deleteUser(user.id);
  deleteCookie(c, "session");
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

app.use(
  "*",
  serveBundled({
    entryPoints: ["index.html", "me.html"],
    replacements: {
      '"{{PASSKEY_ORIGIN}}"': JSON.stringify(idpOrigin),
    },
  }),
);
app.use("*", serveStatic({ root: "./static" }));

app.onError((err, c) => {
  console.error(err);
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  return c.json({ message: "Internal Server Error" }, 500);
});

export { app };
