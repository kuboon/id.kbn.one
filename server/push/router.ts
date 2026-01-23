import {
  PushService,
  type PushSubscriptionMetadata,
  type PushSubscriptionPayload,
  type StoredPushSubscription,
} from "./service.ts";
import type { PasskeyUser } from "../../passkeys/src/hono-middleware/mod.ts";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";

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
  const record = body as {
    subscription?: unknown;
    metadata?: unknown;
  };
  if (!record.subscription) {
    throw new HTTPException(400, {
      message: "subscription is required",
    });
  }
  return {
    subscription: parsePushSubscriptionPayload(record.subscription),
    metadata: sanitizeMetadata(record.metadata),
  };
};

const parsePushMetadataUpdateRequest = async (
  c: Context,
): Promise<PushSubscriptionMetadata> => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON payload" });
  }
  if (!body || typeof body !== "object") {
    throw new HTTPException(400, { message: "Invalid request body" });
  }
  const { metadata } = body as { metadata?: unknown };
  const sanitized = sanitizeMetadata(metadata);
  if (!Object.keys(sanitized).length) {
    throw new HTTPException(400, { message: "metadata is required" });
  }
  return sanitized;
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
  keys: subscription.keys,
  metadata: subscription.metadata,
  createdAt: subscription.createdAt,
  updatedAt: subscription.updatedAt,
});

interface PushRouterDependencies {
  pushService: PushService;
  pushContact: string;
  ensureAuthenticatedUser: (c: Context) => PasskeyUser;
  setNoStore: (c: Context) => void;
}

export const createPushRouter = ({
  pushService,
  pushContact,
  ensureAuthenticatedUser,
  setNoStore,
}: PushRouterDependencies) => {
  if (!(pushService instanceof PushService)) {
    throw new Error("pushService must be an instance of PushService");
  }

  const router = new Hono();

  router.get("/vapid-key", async (c) => {
    setNoStore(c);
    await ensureAuthenticatedUser(c);
    return c.json({
      publicKey: pushService.getPublicKey(),
      contact: pushContact,
    });
  });

  router.get("/subscriptions", async (c) => {
    setNoStore(c);
    const user = await ensureAuthenticatedUser(c);
    const subscriptions = await pushService.listSubscriptions(user.id);
    return c.json({
      subscriptions: subscriptions.map(serializePushSubscription),
    });
  });

  router.post("/subscriptions", async (c) => {
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

  router.delete("/subscriptions/:id", async (c) => {
    setNoStore(c);
    const user = await ensureAuthenticatedUser(c);
    const id = c.req.param("id");
    if (!id || !id.trim()) {
      throw new HTTPException(400, {
        message: "subscription id is required",
      });
    }
    const deleted = await pushService.deleteSubscription(user.id, id.trim());
    if (!deleted) {
      throw new HTTPException(404, { message: "Subscription not found" });
    }
    return c.json({ success: true });
  });

  router.patch("/subscriptions/:id", async (c) => {
    setNoStore(c);
    const user = await ensureAuthenticatedUser(c);
    const id = c.req.param("id");
    if (!id || !id.trim()) {
      throw new HTTPException(400, {
        message: "subscription id is required",
      });
    }
    const metadata = await parsePushMetadataUpdateRequest(c);
    try {
      const updated = await pushService.updateSubscriptionMetadata(
        user.id,
        id.trim(),
        metadata,
      );
      return c.json({ subscription: serializePushSubscription(updated) });
    } catch (error) {
      if (
        error instanceof Error && error.message === "Subscription not found"
      ) {
        throw new HTTPException(404, { message: error.message });
      }
      throw new HTTPException(400, {
        message: error instanceof Error
          ? error.message
          : "Failed to update subscription",
      });
    }
  });

  router.post("/notifications/test", async (c) => {
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
        warnings: result.warnings ?? [],
      });
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error
          ? error.message
          : "Failed to send notification",
      });
    }
  });

  return router;
};
