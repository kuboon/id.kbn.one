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
  // Notification badge image (Web Notifications API `badge`).
  "badge?": "string>0",
  // App-icon badge count (App Badging API `setAppBadge`). `0` clears it.
  "badgeCount?": "number.integer>=0",
  "tag?": "string>0",
  "requireInteraction?": "boolean",
  "data?": "unknown",
  "urgency?": '"very-low" | "low" | "normal" | "high"',
  "ttl?": "number>=0",
  "topic?": "string>0",
});

// RP-server fan-out: target users by id. The notification is delivered to
// every registered device of each named user. A non-empty list is enforced
// in the controller.
export const rpSendNotificationBodySchema = type({
  userIds: "string>0[]",
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
export type RpSendNotificationBody = typeof rpSendNotificationBodySchema.infer;
