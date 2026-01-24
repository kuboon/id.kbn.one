import { type } from "arktype";

export const subscriptionIdParamSchema = type({
  id: "string>0",
});

export const pushSubscriptionPayloadSchema = type({
  endpoint: "string>0",
  expirationTime: "number | null",
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

// Infer types from schemas
export type SubscriptionIdParam = typeof subscriptionIdParamSchema.infer;
export type PushSubscriptionPayload =
  typeof pushSubscriptionPayloadSchema.infer;
export type PushSubscriptionBody = typeof pushSubscriptionBodySchema.infer;
export type UpdateMetadataBody = typeof updateMetadataBodySchema.infer;
export type TestNotificationBody = typeof testNotificationBodySchema.infer;
