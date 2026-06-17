/**
 * Shared notification fan-out helpers used by both the end-user endpoint
 * (`POST /push/notifications`) and the RP-server endpoint
 * (`POST /rp/notifications`).
 */

import { Urgency } from "@negrel/webpush";

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
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> => {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = {
          status: "fulfilled",
          value: await fn(items[index], index),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
};

/** Map the validated request content onto the push service payload shape. */
export const toServicePayload = (
  content: PushNotificationContent,
): PushNotificationPayload => ({
  title: content.title,
  body: content.body,
  url: content.url,
  icon: content.icon,
  badge: content.badge,
  tag: content.tag,
  requireInteraction: content.requireInteraction,
  data: content.data && typeof content.data === "object"
    ? content.data as Record<string, unknown>
    : undefined,
  urgency: content.urgency as Urgency | undefined,
  ttl: content.ttl,
  topic: content.topic,
});
