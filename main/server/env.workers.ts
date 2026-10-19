/**
 * Environment lookup on Cloudflare Workers.
 *
 * `cloudflare:workers` exposes `env` at module scope, so variables and
 * bindings can be read during module evaluation exactly as `Deno.env.get`
 * allowed — no per-request plumbing needed.
 *
 * This is the one file the Workers build supplies itself, through the `#env`
 * alias, and esbuild resolves it without the rest of the project: the Deno
 * bundle is already built by then. So it must import nothing but types and
 * `cloudflare:workers` — a value import of anything under `@kbn/` would send
 * esbuild into JSR specifiers it cannot follow. Wrapping a binding in a
 * repository therefore belongs in `kv-backend.ts`, not here.
 *
 * Deno cannot resolve `cloudflare:workers` either, so this package's import
 * map points that specifier at `cloudflare-workers.shim.ts` — enough for
 * `deno check` to cover this file, and never reached by the Workers build.
 */

import { env } from "cloudflare:workers";

import type { Middleware } from "@remix-run/fetch-router";

import type { D1Like } from "@kbn/kv/d1.ts";

export const readEnv = (name: string): string | undefined => {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
};

/**
 * None: Workers Static Assets answers a matching path before the Worker is
 * invoked at all, so the router never sees a request for a built asset.
 */
export const staticMiddleware = (): Middleware[] => [];

/**
 * The D1 binding named `DB` in the Cloudflare configuration. There is no Deno
 * KV on Workers, so a missing binding is a deployment error and not something
 * to fall back from: every repository would silently lose its data.
 */
export const getD1Database = (): D1Like => {
  const db = (env as unknown as { DB?: D1Like }).DB;
  if (!db) {
    throw new Error(
      "the D1 binding `DB` is missing; check env.DB in cloudflare.config.ts",
    );
  }
  return db;
};
