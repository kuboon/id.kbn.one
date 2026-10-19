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

import { D1Repo } from "@kbn/kv/d1.ts";
import type { D1Like } from "@kbn/kv/d1.ts";
import { DenoKvRepo } from "@kbn/kv/denoKv.ts";
import type { KvKey, KvOptions, KvRepo } from "@kbn/kv/types.ts";

import { getD1Database, hasD1 } from "#env";

/**
 * Reaches the binding on the first query rather than at import.
 *
 * Deploying a Worker runs its top-level scope to validate it, and the binding
 * is not there yet during that pass: resolving it at module scope threw, and
 * the deploy was rejected with error 10021. Nothing here needs the database
 * before a request anyway.
 */
const lazyD1: D1Like = {
  prepare: (sql) => getD1Database()!.prepare(sql),
};

/** A repository over whichever backend this runtime provides. */
export const createRepo = <TVal>(
  prefix: KvKey = [],
  options: KvOptions = {},
): KvRepo<TVal> =>
  hasD1
    ? new D1Repo<TVal>(lazyD1, prefix, options)
    : new DenoKvRepo<TVal>(prefix, options);
