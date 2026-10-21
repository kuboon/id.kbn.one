/**
 * Where the app's KV data lives.
 *
 * The choice of backend is made once, here, rather than in each repository:
 * Deno KV when running under Deno, Cloudflare D1 when running as a Worker.
 * Both implement {@link KvRepo}, so nothing downstream knows which it has.
 *
 * This lives on our side of the `#env` seam rather than inside it, because
 * the seam is resolved by esbuild during the Workers build and cannot follow
 * the JSR specifiers these imports rest on. `#env` only answers *which*
 * backend this runtime has; wrapping it in a repository happens here, where
 * Deno has already bundled both implementations.
 *
 * @module
 */

import { D1Repo, lazyD1 } from "@kbn/kv/d1.ts";
import { DenoKvRepo } from "@kbn/kv/denoKv.ts";
import type { KvKey, KvOptions, KvRepo } from "@kbn/kv/types.ts";

import { getD1Database, hasD1 } from "#env";

/**
 * The database, reached per statement and with its schema ensured first —
 * see {@link lazyD1} for why both. Shared by every repository so the schema
 * check runs once per isolate, not once per prefix.
 */
const d1 = lazyD1(() => getD1Database()!);

/** A repository over whichever backend this runtime provides. */
export const createRepo = <TVal>(
  prefix: KvKey = [],
  options: KvOptions = {},
): KvRepo<TVal> =>
  hasD1
    ? new D1Repo<TVal>(d1, prefix, options)
    : new DenoKvRepo<TVal>(prefix, options);

/** The same handle, for the cron sweep. `undefined` where there is no D1. */
export const d1Database = hasD1 ? d1 : undefined;
