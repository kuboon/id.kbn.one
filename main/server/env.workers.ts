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

import type { Middleware } from "@remix-run/fetch-router";

import { D1Repo } from "@kbn/kv/d1.ts";
import type { D1Like } from "@kbn/kv/d1.ts";
import type { KvKey, KvOptions, KvRepo } from "@kbn/kv/types.ts";

/**
 * None: Workers Static Assets answers a matching path before the Worker is
 * invoked at all, so the router never sees a request for a built asset.
 */
export const staticMiddleware = (): Middleware[] => [];

export const readEnv = (name: string): string | undefined => {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
};

/**
 * The D1 binding named `DB` in the Wrangler configuration. There is no Deno KV
 * on Workers, so a missing binding is a deployment error and not something to
 * fall back from: every repository would silently lose its data.
 */
export const getD1Database = (): D1Like => {
  const db = (env as unknown as { DB?: D1Like }).DB;
  if (!db) {
    throw new Error(
      "the D1 binding `DB` is missing; check d1_databases in wrangler.jsonc",
    );
  }
  return db;
};

/** Repositories over D1. The binding is resolved once, not per request. */
const db = getD1Database();

export const createRepo = <TVal>(
  prefix: KvKey = [],
  options: KvOptions = {},
): KvRepo<TVal> => new D1Repo<TVal>(db, prefix, options);
