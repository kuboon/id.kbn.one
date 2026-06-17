/**
 * /push/* — VAPID key, subscriptions CRUD, and notification dispatch.
 *
 * Every endpoint here is exposed to the `cors:` route group so RP frontends
 * on a different origin can manage and trigger notifications for the
 * signed-in user.
 */

import type { RequestContext } from "@remix-run/fetch-router";
import { type } from "arktype";

import { pushContact } from "../config.ts";
import { setNoStore } from "../middleware/auth.ts";
import { User } from "../middleware/user.ts";
import {
  pushService,
  type PushSubscriptionMetadata,
  type StoredPushSubscription,
} from "../lib/push/service.ts";
import {
  pushSubscriptionBodySchema,
  sendNotificationBodySchema,
  subscriptionIdParamSchema,
  testNotificationBodySchema,
  updateMetadataBodySchema,
} from "../lib/push/schemas.ts";
import {
  mapWithConcurrency,
  MAX_NOTIFICATION_TARGETS,
  PUSH_SEND_CONCURRENCY,
  toServicePayload,
} from "../lib/push/dispatch.ts";

const sanitizeMetadata = (metadata: unknown): PushSubscriptionMetadata => {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  const record = metadata as Record<string, unknown>;
  const sanitizeString = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  };

  const result: PushSubscriptionMetadata = {};
  const deviceName = sanitizeString(record.deviceName);
  if (deviceName) result.deviceName = deviceName;
  if (record.platform === null) {
    result.platform = null;
  } else {
    const platform = sanitizeString(record.platform);
    if (platform) result.platform = platform;
  }
  const userAgent = sanitizeString(record.userAgent);
  if (userAgent) result.userAgent = userAgent;
  const language = sanitizeString(record.language);
  if (language) result.language = language;
  const timezone = sanitizeString(record.timezone);
  if (timezone) result.timezone = timezone;
  return result;
};

const serialize = (subscription: StoredPushSubscription) => ({
  id: subscription.id,
  endpoint: subscription.endpoint,
  expirationTime: subscription.expirationTime,
  keys: subscription.keys,
  metadata: subscription.metadata,
  createdAt: subscription.createdAt,
  updatedAt: subscription.updatedAt,
});

const errorResponse = (status: number, message: string): Response =>
  Response.json({ message }, { status });

const validateBody = async <T>(
  request: Request,
  schema: { (input: unknown): T | type.errors },
): Promise<T | Response> => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }
  const result = schema(raw);
  if (result instanceof type.errors) {
    return errorResponse(400, result.summary);
  }
  return result;
};

const validateParams = <T>(
  params: unknown,
  schema: { (input: unknown): T | type.errors },
): T | Response => {
  const result = schema(params);
  if (result instanceof type.errors) {
    return errorResponse(400, result.summary);
  }
  return result;
};

export const pushController = {
  actions: {
    vapidKey(_context: RequestContext) {
      return setNoStore(Response.json({
        publicKey: pushService.getPublicKey(),
        contact: pushContact,
      }));
    },

    async listSubscriptions(context: RequestContext) {
      const { id: userId } = context.get(User);
      const subscriptions = await pushService.listSubscriptions(userId);
      return setNoStore(
        Response.json({ subscriptions: subscriptions.map(serialize) }),
      );
    },

    async upsertSubscription(context: RequestContext) {
      const { id: userId } = context.get(User);
      const body = await validateBody(
        context.request,
        pushSubscriptionBodySchema,
      );
      if (body instanceof Response) return body;
      try {
        const stored = await pushService.upsertSubscription(
          userId,
          body.subscription,
          sanitizeMetadata(body.metadata),
        );
        return setNoStore(Response.json({ subscription: serialize(stored) }));
      } catch (error) {
        return errorResponse(
          400,
          error instanceof Error
            ? error.message
            : "Failed to save subscription",
        );
      }
    },

    async updateSubscription(context: RequestContext) {
      const { id: userId } = context.get(User);
      const param = validateParams(context.params, subscriptionIdParamSchema);
      if (param instanceof Response) return param;
      const body = await validateBody(
        context.request,
        updateMetadataBodySchema,
      );
      if (body instanceof Response) return body;
      const sanitized = sanitizeMetadata(body.metadata);
      if (!Object.keys(sanitized).length) {
        return errorResponse(400, "metadata is required");
      }
      try {
        const updated = await pushService.updateSubscriptionMetadata(
          userId,
          param.id,
          sanitized,
        );
        return setNoStore(Response.json({ subscription: serialize(updated) }));
      } catch (error) {
        if (
          error instanceof Error && error.message === "Subscription not found"
        ) {
          return errorResponse(404, error.message);
        }
        return errorResponse(
          400,
          error instanceof Error
            ? error.message
            : "Failed to update subscription",
        );
      }
    },

    async deleteSubscription(context: RequestContext) {
      const { id: userId } = context.get(User);
      const param = validateParams(context.params, subscriptionIdParamSchema);
      if (param instanceof Response) return param;
      const deleted = await pushService.deleteSubscription(userId, param.id);
      if (!deleted) return errorResponse(404, "Subscription not found");
      return setNoStore(Response.json({ success: true }));
    },

    async testNotification(context: RequestContext) {
      const { id: userId } = context.get(User);
      const body = await validateBody(
        context.request,
        testNotificationBodySchema,
      );
      if (body instanceof Response) return body;
      try {
        const result = await pushService.sendTestNotification(
          userId,
          body.subscriptionId,
        );
        return setNoStore(Response.json({
          subscription: serialize(result.subscription),
          removed: result.removed ?? false,
          warnings: result.warnings ?? [],
        }));
      } catch (error) {
        return errorResponse(
          400,
          error instanceof Error
            ? error.message
            : "Failed to send notification",
        );
      }
    },

    async sendNotification(context: RequestContext) {
      const { id: userId } = context.get(User);
      const body = await validateBody(
        context.request,
        sendNotificationBodySchema,
      );
      if (body instanceof Response) return body;

      if (body.subscriptionId && body.subscriptionIds) {
        return errorResponse(
          400,
          "Provide either subscriptionId or subscriptionIds, not both",
        );
      }

      const payload = toServicePayload(body.notification);

      const explicit = body.subscriptionIds ??
        (body.subscriptionId ? [body.subscriptionId] : undefined);
      // De-duplicate explicit targets so a repeated id is only delivered once
      // and only appears once in the results.
      const targets = explicit
        ? [...new Set(explicit)]
        : (await pushService.listSubscriptions(userId)).map((s) => s.id);

      if (targets.length === 0) {
        return setNoStore(Response.json({ results: [] }));
      }

      if (targets.length > MAX_NOTIFICATION_TARGETS) {
        return errorResponse(
          400,
          `Too many targets: ${targets.length} (max ${MAX_NOTIFICATION_TARGETS})`,
        );
      }

      const settled = await mapWithConcurrency(
        targets,
        PUSH_SEND_CONCURRENCY,
        (id) => pushService.sendNotification(userId, id, payload),
      );

      const results = settled.map((r, i) =>
        r.status === "fulfilled"
          ? {
            subscriptionId: targets[i],
            ok: true,
            removed: r.value.removed ?? false,
            warnings: r.value.warnings ?? [],
          }
          : {
            subscriptionId: targets[i],
            ok: false,
            error: r.reason instanceof Error
              ? r.reason.message
              : String(r.reason),
          }
      );

      return setNoStore(Response.json({ results }));
    },
  },
};
