/**
 * Environment lookup on Deno (local dev and the test suite).
 *
 * Selected through the `#env` import-map alias; the Workers build maps the
 * same alias to `env.workers.ts`. Keeping it behind an alias is what lets
 * `config.ts` read its values at module scope on both runtimes, since
 * `cloudflare:workers` cannot be resolved under `deno test`.
 */

import type { D1Like } from "@kbn/kv/d1.ts";

export const readEnv = (name: string): string | undefined => Deno.env.get(name);

/**
 * No D1 under Deno, so the app keeps Deno KV here. D1 is reachable from a
 * Worker only, which means `wrangler dev` is what exercises that path locally;
 * the suite covers it against a real SQL engine instead.
 */
export const getD1Database = (): D1Like | undefined => undefined;
