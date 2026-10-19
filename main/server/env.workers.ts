/**
 * Environment lookup on Cloudflare Workers.
 *
 * `cloudflare:workers` exposes `env` at module scope, so variables and
 * bindings can be read during module evaluation exactly as `Deno.env.get`
 * allowed — no per-request plumbing needed.
 *
 * Deno cannot resolve `cloudflare:workers`, so this file is excluded from
 * `deno check`/`lint`/`fmt`; the Workers build type-checks it instead. It is
 * reached only through the `#env` alias, which the Workers build points here.
 */

import { env } from "cloudflare:workers";

export const readEnv = (name: string): string | undefined => {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
};
