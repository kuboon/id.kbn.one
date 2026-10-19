/**
 * Environment lookup on Deno (local dev and the test suite).
 *
 * Selected through the `#env` import-map alias; the Workers build maps the
 * same alias to `env.workers.ts`. Keeping it behind an alias is what lets
 * `config.ts` read its values at module scope on both runtimes, since
 * `cloudflare:workers` cannot be resolved under `deno test`.
 */

export const readEnv = (name: string): string | undefined => Deno.env.get(name);
