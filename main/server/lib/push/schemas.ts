import { type } from "arktype";

export const subscriptionIdParamSchema = type({
  id: "string>0",
});

export const pushSubscriptionPayloadSchema = type({
  endpoint: "string>0",
  "expirationTime?": "number | null",
  keys: {
    auth: "string>0",
    p256dh: "string>0",
  },
});

export const pushSubscriptionBodySchema = type({
  subscription: pushSubscriptionPayloadSchema,
  "metadata?": "unknown",
});

export const updateMetadataBodySchema = type({
  metadata: "unknown",
});

export const testNotificationBodySchema = type({
  subscriptionId: "string>0",
});

export const pushNotificationContentSchema = type({
  title: "string>0",
  body: "string>0",
  "url?": "string>0",
  "icon?": "string>0",
  "badge?": "string>0",
  "tag?": "string>0",
  "requireInteraction?": "boolean",
  "data?": "unknown",
  "urgency?": '"very-low" | "low" | "normal" | "high"',
  "ttl?": "number>=0",
  "topic?": "string>0",
});

export const sendNotificationBodySchema = type({
  // Single target (back-compat). Mutually exclusive with `subscriptionIds`.
  "subscriptionId?": "string>0",
  // Multiple explicit targets for a one-shot fan-out. When omitted (and
  // `subscriptionId` is also absent) the notification goes to every
  // subscription of the signed-in user.
  "subscriptionIds?": "string>0[]",
  notification: pushNotificationContentSchema,
});

// RP-server fan-out: target by user(s) and/or explicit subscription id(s).
// At least one targeting field must be present (enforced in the controller),
// since a registered RP could otherwise notify every user at once.
export const rpSendNotificationBodySchema = type({
  "userId?": "string>0",
  "userIds?": "string>0[]",
  "subscriptionIds?": "string>0[]",
  notification: pushNotificationContentSchema,
});

// Infer types from schemas
export type SubscriptionIdParam = typeof subscriptionIdParamSchema.infer;
export type PushSubscriptionPayload =
  typeof pushSubscriptionPayloadSchema.infer;
export type PushSubscriptionBody = typeof pushSubscriptionBodySchema.infer;
export type UpdateMetadataBody = typeof updateMetadataBodySchema.infer;
export type TestNotificationBody = typeof testNotificationBodySchema.infer;
export type PushNotificationContent =
  typeof pushNotificationContentSchema.infer;
export type SendNotificationBody = typeof sendNotificationBodySchema.infer;
export type RpSendNotificationBody = typeof rpSendNotificationBodySchema.infer;
