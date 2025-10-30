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
  type PasskeySessionState,
  type PasskeyUser,
} from "@scope/hono-passkeys-middleware";

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { Secret } from "./secret.ts";

const kv = await getKvInstance();
const credentialStore = new DenoKvPasskeyStore(kv);
const pushService = await PushService.create(kv);

const allowedOrigins = [
  ...(idpOrigin ? [idpOrigin] : []),
  ...relatedOrigins,
];

const SESSION_COOKIE_NAME = "passkey_session";

const setNoStore = (c: Context) => {
  c.header("Cache-Control", "no-store");
};

const createDefaultSessionState = (): PasskeySessionState => ({
  user: null,
});

const getSessionState = (c: Context): PasskeySessionState =>
  (c.get("passkey") as PasskeySessionState | undefined) ??
    createDefaultSessionState();

const setSessionState = (c: Context, state: PasskeySessionState) => {
  c.set("passkey", state);
};

const clearSession = (c: Context) => {
  deleteCookie(c, SESSION_COOKIE_NAME);
  setSessionState(c, createDefaultSessionState());
};

const ensureAuthenticatedUser = async (c: Context): Promise<PasskeyUser> => {
  const session = getSessionState(c);
  if (!session.user) {
    throw new HTTPException(401, { message: "Sign-in required" });
  }
  const user = await credentialStore.getUserById(session.user.id);
  if (!user) {
    clearSession(c);
    throw new HTTPException(404, { message: "User not found" });
  }
  return user;
};

const updateSessionUser = (c: Context, user: PasskeyUser) => {
  setSessionState(c, { user });
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

const readStaticText = async (relativePath: string) => {
  const url = new URL(`./static/${relativePath}`, import.meta.url);
  return await Deno.readTextFile(url);
};

const signingKey = await Secret<string>("signing_key", () => {
  const key = crypto.randomUUID();
  console.info(`Generated new signing key: ${key}`);
  return key;
}, 60 * 60 * 24); // 1 day expiration

const app = new Hono();
app.use("*", cors({ origin: allowedOrigins }));

app.use(
  createPasskeyMiddleware({
    rpID,
    rpName,
    storage: credentialStore,
    secret: await signingKey.get(),
  }),
);

app.get("/session", (c) => {
  setNoStore(c);
  return c.json(getSessionState(c));
});

app.get("/.well-known/webauthn", (c) => {
  if (relatedOrigins.length > 0) {
    c.header("Cache-Control", "public, max-age=86400");
  }
  return c.json({ origins: relatedOrigins });
});

app.post("/session/logout", (c) => {
  setNoStore(c);
  clearSession(c);
  return c.json({ success: true });
});

app.patch("/account", async (c) => {
  setNoStore(c);
  const currentUser = await ensureAuthenticatedUser(c);
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
  updateSessionUser(c, updatedUser);
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
  clearSession(c);
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

app.get("/", async (c) => {
  const html = await readStaticText("index.html");
  return c.html(html);
});

app.get("/me", async (c) => {
  const session = getSessionState(c);
  if (!session.user) {
    return c.redirect("/", 302);
  }
  const html = await readStaticText("me.html");
  return c.html(html);
});

app.get("/styles.css", async (c) => {
  const css = await readStaticText("styles.css");
  c.header("Content-Type", "text/css; charset=utf-8");
  return c.body(css);
});

app.get("/usage.md", async (c) => {
  const markdown = await readStaticText("usage.md");
  c.header("Content-Type", "text/markdown; charset=utf-8");
  return c.body(markdown);
});

app.get("/sw.js", async (c) => {
  const script = await readStaticText("sw.js");
  c.header("Content-Type", "application/javascript; charset=utf-8");
  return c.body(script);
});

app.onError((err, c) => {
  console.error(err);
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  return c.json({ message: "Internal Server Error" }, 500);
});

export { app };
