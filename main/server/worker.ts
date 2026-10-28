/**
 * Cloudflare Workers entry point.
 *
 * The router itself is the same module Deno serves (`router.ts`); only the
 * runtime seams differ, and those are behind the `#env` alias — which the
 * Workers build points at `env.workers.ts`. So there is little here beyond
 * handing requests over and sweeping expired rows.
 *
 * @module
 */

import { sweepExpired } from "@kuboon/kv/d1.ts";

import { d1Database } from "#server/kv-backend.ts";
import router from "#server/router.ts";

export default {
  fetch(request: Request): Promise<Response> | Response {
    return router.fetch(request);
  },

  /**
   * D1 has no TTL of its own, so entries that expire — sessions, DPoP proof
   * ids, consumed OAuth jtis, push rate-limit counters — are only *read* as
   * absent. Without this they would accumulate forever. Reads already filter
   * on `expires_at`, so a missed run costs storage, never correctness.
   */
  async scheduled(): Promise<void> {
    // Undefined only under Deno, where the suite type-checks this file and
    // there is no D1 to sweep. On Workers it is the shared handle, so a cron
    // run on a fresh database creates the table rather than failing on it.
    if (!d1Database) return;
    const removed = await sweepExpired(d1Database);
    if (removed > 0) console.info(`swept ${removed} expired rows`);
  },
};
