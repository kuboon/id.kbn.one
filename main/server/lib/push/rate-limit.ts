/**
 * Per-subscription send rate limiting — `@remix-kbn/web-push`'s
 * {@link PushRateLimiter}, counting in our KV.
 *
 * A fixed-window counter keyed by `${subscriptionId}:${windowId}` caps how
 * many notifications a single subscription receives per window, so a device
 * can't be flooded by a burst of sends. Counters expire on their own.
 */

export { PushRateLimiter } from "@remix-kbn/web-push/server";

/**
 * Fixed per-subscription send rate: at most `RATE_LIMIT` notifications per
 * `RATE_WINDOW_MS` window. Over-limit sends are throttled (skipped) so a
 * device can't be flooded. (The package's defaults; stated here for callers
 * that pass them explicitly.)
 */
export const RATE_LIMIT = 1;
export const RATE_WINDOW_MS = 60_000;
