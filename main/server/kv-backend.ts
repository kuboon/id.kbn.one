/**
 * Where the app's KV data lives.
 *
 * The choice of backend is made once, here, rather than in each repository:
 * Deno KV when running under Deno, Cloudflare D1 when running as a Worker.
 * Both implement {@link KvRepo}, so nothing downstream knows which it has.
 *
 * @module
 */

import { D1Repo } from "@kbn/kv/d1.ts";
import { DenoKvRepo } from "@kbn/kv/denoKv.ts";
import type { KvKey, KvOptions, KvRepo } from "@kbn/kv/types.ts";

import { getD1Database } from "#env";

// Resolved at module scope: on Workers the binding is available there, and a
// per-request lookup would buy nothing.
const db = getD1Database();

/** A repository over whichever backend this runtime provides. */
export const createRepo = <TVal>(
  prefix: KvKey = [],
  options: KvOptions = {},
): KvRepo<TVal> =>
  db
    ? new D1Repo<TVal>(db, prefix, options)
    : new DenoKvRepo<TVal>(prefix, options);
