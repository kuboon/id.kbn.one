import {
  createPasskeyMiddleware,
  type PasskeySessionState,
  type PasskeyUser,
} from "@kuboon/hono-passkeys-middleware";
import { DenoKvPasskeyStore } from "./deno-kv-passkey-store.ts";
import {
  idpOrigin,
  pushContact,
  relatedOrigins,
  rpID,
  rpName,
} from "./config.ts";

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import {
  PushService,
  type PushSubscriptionMetadata,
  type PushSubscriptionPayload,
  type StoredPushSubscription,
} from "./push/service.ts";

const app = new Hono();
const credentialStore = await DenoKvPasskeyStore.create();
const pushService = await PushService.create(credentialStore.getKv(), {
  contactInformation: pushContact,
});

const allowedOrigins = [
  ...(idpOrigin ? [idpOrigin] : []),
  ...relatedOrigins,
];

const SESSION_COOKIE_NAME = "passkey_session";
const baseCookieOptions = {
  httpOnly: true,
  sameSite: "Lax" as const,
  path: "/",
};

const isSecureRequest = (c: Context) => c.req.url.startsWith("https://");

const setNoStore = (c: Context) => {
  c.header("Cache-Control", "no-store");
};

const createDefaultSessionState = (): PasskeySessionState => ({
  isAuthenticated: false,
  user: null,
});

const getSessionState = (c: Context): PasskeySessionState =>
  (c.get("passkey") as PasskeySessionState | undefined) ??
    createDefaultSessionState();

const setSessionState = (c: Context, state: PasskeySessionState) => {
  c.set("passkey", state);
};

const clearSession = (c: Context) => {
  setCookie(c, SESSION_COOKIE_NAME, "", {
    ...baseCookieOptions,
    secure: isSecureRequest(c),
    maxAge: 0,
  });
  setSessionState(c, createDefaultSessionState());
};

const ensureAuthenticatedUser = async (c: Context): Promise<PasskeyUser> => {
  const session = getSessionState(c);
  if (!session.isAuthenticated || !session.user) {
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
  setSessionState(c, { isAuthenticated: true, user });
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

const sanitizeMetadata = (metadata: unknown): PushSubscriptionMetadata => {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  const record = metadata as Record<string, unknown>;
  const sanitizeString = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const result: PushSubscriptionMetadata = {};
  const deviceName = sanitizeString(record.deviceName);
  if (deviceName) {
    result.deviceName = deviceName;
  }
  if (record.platform === null) {
    result.platform = null;
  } else {
    const platform = sanitizeString(record.platform);
    if (platform) {
      result.platform = platform;
    }
  }
  const userAgent = sanitizeString(record.userAgent);
  if (userAgent) {
    result.userAgent = userAgent;
  }
  const language = sanitizeString(record.language);
  if (language) {
    result.language = language;
  }
  const timezone = sanitizeString(record.timezone);
  if (timezone) {
    result.timezone = timezone;
  }
  return result;
};

const parsePushSubscriptionPayload = (
  value: unknown,
): PushSubscriptionPayload => {
  if (!value || typeof value !== "object") {
    throw new HTTPException(400, { message: "subscription is required" });
  }
  const raw = value as {
    endpoint?: unknown;
    expirationTime?: unknown;
    keys?: unknown;
  };
  if (typeof raw.endpoint !== "string" || !raw.endpoint.trim()) {
    throw new HTTPException(400, {
      message: "subscription endpoint is required",
    });
  }
  if (!raw.keys || typeof raw.keys !== "object") {
    throw new HTTPException(400, {
      message: "subscription keys are required",
    });
  }
  const keysRecord = raw.keys as { auth?: unknown; p256dh?: unknown };
  if (typeof keysRecord.auth !== "string" || !keysRecord.auth) {
    throw new HTTPException(400, {
      message: "subscription auth key is required",
    });
  }
  if (typeof keysRecord.p256dh !== "string" || !keysRecord.p256dh) {
    throw new HTTPException(400, {
      message: "subscription p256dh key is required",
    });
  }
  return {
    endpoint: raw.endpoint.trim(),
    expirationTime: typeof raw.expirationTime === "number"
      ? raw.expirationTime
      : null,
    keys: {
      auth: keysRecord.auth,
      p256dh: keysRecord.p256dh,
    },
  };
};

const parsePushSubscriptionRequest = async (
  c: Context,
): Promise<{
  subscription: PushSubscriptionPayload;
  metadata: PushSubscriptionMetadata;
}> => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON payload" });
  }
  if (!body || typeof body !== "object") {
    throw new HTTPException(400, { message: "Invalid request body" });
  }
  const { subscription, metadata } = body as {
    subscription?: unknown;
    metadata?: unknown;
  };
  if (subscription === undefined) {
    throw new HTTPException(400, { message: "subscription is required" });
  }
  return {
    subscription: parsePushSubscriptionPayload(subscription),
    metadata: sanitizeMetadata(metadata),
  };
};

const parsePushTestRequest = async (
  c: Context,
): Promise<{ subscriptionId: string }> => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON payload" });
  }
  if (!body || typeof body !== "object") {
    throw new HTTPException(400, { message: "Invalid request body" });
  }
  const { subscriptionId } = body as { subscriptionId?: unknown };
  if (typeof subscriptionId !== "string" || !subscriptionId.trim()) {
    throw new HTTPException(400, {
      message: "subscriptionId is required",
    });
  }
  return { subscriptionId: subscriptionId.trim() };
};

const serializePushSubscription = (
  subscription: StoredPushSubscription,
) => ({
  id: subscription.id,
  endpoint: subscription.endpoint,
  expirationTime: subscription.expirationTime,
  createdAt: subscription.createdAt,
  updatedAt: subscription.updatedAt,
  metadata: subscription.metadata,
});

app.use("*", cors({ origin: allowedOrigins }));

app.use(
  createPasskeyMiddleware({
    rpID,
    rpName,
    storage: credentialStore,
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

app.get("/push/vapid-key", async (c) => {
  setNoStore(c);
  await ensureAuthenticatedUser(c);
  return c.json({
    publicKey: pushService.getPublicKey(),
    contact: pushContact,
  });
});

app.get("/push/subscriptions", async (c) => {
  setNoStore(c);
  const user = await ensureAuthenticatedUser(c);
  const subscriptions = await pushService.listSubscriptions(user.id);
  return c.json({
    subscriptions: subscriptions.map(serializePushSubscription),
  });
});

app.post("/push/subscriptions", async (c) => {
  setNoStore(c);
  const user = await ensureAuthenticatedUser(c);
  const { subscription, metadata } = await parsePushSubscriptionRequest(c);
  try {
    const stored = await pushService.upsertSubscription(
      user.id,
      subscription,
      metadata,
    );
    return c.json({ subscription: serializePushSubscription(stored) });
  } catch (error) {
    throw new HTTPException(400, {
      message: error instanceof Error
        ? error.message
        : "Failed to save subscription",
    });
  }
});

app.delete("/push/subscriptions/:id", async (c) => {
  setNoStore(c);
  const user = await ensureAuthenticatedUser(c);
  const id = c.req.param("id");
  if (!id || !id.trim()) {
    throw new HTTPException(400, { message: "subscription id is required" });
  }
  const deleted = await pushService.deleteSubscription(user.id, id.trim());
  if (!deleted) {
    throw new HTTPException(404, { message: "Subscription not found" });
  }
  return c.json({ success: true });
});

app.post("/push/notifications/test", async (c) => {
  setNoStore(c);
  const user = await ensureAuthenticatedUser(c);
  const { subscriptionId } = await parsePushTestRequest(c);
  try {
    const result = await pushService.sendTestNotification(
      user.id,
      subscriptionId,
    );
    return c.json({
      subscription: serializePushSubscription(result.subscription),
      removed: result.removed ?? false,
    });
  } catch (error) {
    throw new HTTPException(400, {
      message: error instanceof Error
        ? error.message
        : "Failed to send notification",
    });
  }
});

app.get("/", async (c) => {
  const html = await readStaticText("index.html");
  return c.html(html);
});

app.get("/me", async (c) => {
  const session = getSessionState(c);
  if (!session.isAuthenticated || !session.user) {
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
