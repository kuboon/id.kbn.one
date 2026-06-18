/**
 * Per-subscription send rate limiting.
 *
 * A fixed-window counter keyed by `${subscriptionId}:${windowId}` (where
 * `windowId = floor(now / windowMs)`) caps how many notifications a single
 * subscription receives per window, so a device can't be flooded by a burst
 * of sends. Counters expire on their own.
 */

import type { DenoKvRepo } from "@kbn/kv/denoKv.ts";

/**
 * Fixed per-subscription send rate: at most `RATE_LIMIT` notifications per
 * `RATE_WINDOW_MS` window. Over-limit sends are throttled (skipped) so a
 * device can't be flooded.
 */
export const RATE_LIMIT = 1;
export const RATE_WINDOW_MS = 60_000;

export class PushRateLimiter {
  constructor(
    private readonly repo: DenoKvRepo<number>,
    private readonly limit: number = RATE_LIMIT,
    private readonly windowMs: number = RATE_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Atomically count a send against `subscriptionId`'s current window.
   * Returns `true` when the send is allowed (and recorded), `false` when the
   * window's limit is already reached. A non-positive limit disables
   * throttling.
   */
  async tryAcquire(subscriptionId: string): Promise<boolean> {
    if (this.limit <= 0 || this.windowMs <= 0) return true;

    const windowId = Math.floor(this.now() / this.windowMs);
    const entry = this.repo.entry(`${subscriptionId}:${windowId}`);
    const expireIn = this.windowMs * 2;

    // `update` is a single atomic check-and-set; retry a few times if a
    // concurrent send wins the race for the same window.
    for (let attempt = 0; attempt < 3; attempt++) {
      let allowed = false;
      const result = await entry.update((current) => {
        const count = current ?? 0;
        if (count >= this.limit) {
          allowed = false;
          return count;
        }
        allowed = true;
        return count + 1;
      }, { expireIn });
      if (result.ok) return allowed;
    }

    // Persistent contention (rare): fail open rather than silently dropping a
    // legitimate notification.
    return true;
  }
}
