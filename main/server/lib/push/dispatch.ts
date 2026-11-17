/**
 * Shared notification fan-out helpers used by both the end-user endpoint
 * (`POST /push/notifications`) and the RP-server endpoint
 * (`POST /rp/notifications`).
 */

import type { PushUrgency } from "@remix-kbn/web-push/server";

import type { PushNotificationPayload } from "./service.ts";
import type { PushNotificationContent } from "./schemas.ts";

/**
 * Upper bound on how many subscriptions a single dispatch call may target.
 * Web Push itself imposes no protocol limit, but each target is an
 * independent HTTPS request to a push service, so we cap the request to keep
 * latency and outbound connection use bounded. Larger audiences should be
 * split across multiple calls (or a future queue-backed job).
 */
export const MAX_NOTIFICATION_TARGETS = 500;

/**
 * How many push deliveries run at once. Push services (FCM / Mozilla / Apple)
 * rate-limit aggressive senders, and the runtime caps concurrent outbound
 * connections, so we drain targets through a bounded worker pool rather than
 * firing every request simultaneously.
 */
export const PUSH_SEND_CONCURRENCY = 10;

/**
 * Run `fn` over `items` with at most `limit` in flight at a time, preserving
 * input order in the returned settled results.
 */
export { mapWithConcurrency } from "@remix-kbn/web-push/server";

/** Map the validated request content onto the push service payload shape. */
export const toServicePayload = (
  content: PushNotificationContent,
): PushNotificationPayload => ({
  title: content.title,
  body: content.body,
  url: content.url,
  icon: content.icon,
  badge: content.badge,
  badgeCount: content.badgeCount,
  tag: content.tag,
  requireInteraction: content.requireInteraction,
  data: content.data && typeof content.data === "object"
    ? content.data as Record<string, unknown>
    : undefined,
  urgency: content.urgency as PushUrgency | undefined,
  ttl: content.ttl,
  topic: content.topic,
});
