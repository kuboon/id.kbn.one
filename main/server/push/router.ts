import {
  PushService,
  type PushSubscriptionMetadata,
  type StoredPushSubscription,
} from "./service.ts";

import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sValidator } from "@hono/standard-validator";
import {
  pushSubscriptionBodySchema,
  subscriptionIdParamSchema,
  testNotificationBodySchema,
  updateMetadataBodySchema,
} from "./schemas.ts";

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
    return trimmed || undefined;
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
  ensureAuthenticatedUser: (c: Context) => string;
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

  const router = new Hono().get("/vapid-key", async (c) => {
    setNoStore(c);
    await ensureAuthenticatedUser(c);
    return c.json({
      publicKey: pushService.getPublicKey(),
      contact: pushContact,
    });
  }).get("/subscriptions", async (c) => {
    setNoStore(c);
    const userId = ensureAuthenticatedUser(c);
    const subscriptions = await pushService.listSubscriptions(userId);
    return c.json({
      subscriptions: subscriptions.map(serializePushSubscription),
    });
  }).post(
    "/subscriptions",
    sValidator("json", pushSubscriptionBodySchema),
    async (c) => {
      setNoStore(c);
      const userId = ensureAuthenticatedUser(c);
      const { subscription, metadata } = c.req.valid("json");
      try {
        const stored = await pushService.upsertSubscription(
          userId,
          subscription,
          sanitizeMetadata(metadata),
        );
        return c.json({ subscription: serializePushSubscription(stored) });
      } catch (error) {
        throw new HTTPException(400, {
          message: error instanceof Error
            ? error.message
            : "Failed to save subscription",
        });
      }
    },
  ).delete(
    "/subscriptions/:id",
    sValidator("param", subscriptionIdParamSchema),
    async (c) => {
      setNoStore(c);
      const userId = ensureAuthenticatedUser(c);
      const { id } = c.req.valid("param");
      const deleted = await pushService.deleteSubscription(userId, id);
      if (!deleted) {
        throw new HTTPException(404, { message: "Subscription not found" });
      }
      return c.json({ success: true });
    },
  ).patch(
    "/subscriptions/:id",
    sValidator("param", subscriptionIdParamSchema),
    sValidator("json", updateMetadataBodySchema),
    async (c) => {
      setNoStore(c);
      const userId = ensureAuthenticatedUser(c);
      const { id } = c.req.valid("param");
      const { metadata } = c.req.valid("json");
      const sanitized = sanitizeMetadata(metadata);
      if (!Object.keys(sanitized).length) {
        throw new HTTPException(400, { message: "metadata is required" });
      }
      try {
        const updated = await pushService.updateSubscriptionMetadata(
          userId,
          id,
          sanitized,
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
    },
  ).post(
    "/notifications/test",
    sValidator("json", testNotificationBodySchema),
    async (c) => {
      setNoStore(c);
      const userId = ensureAuthenticatedUser(c);
      const { subscriptionId } = c.req.valid("json");
      try {
        const result = await pushService.sendTestNotification(
          userId,
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
    },
  );

  return router;
};
