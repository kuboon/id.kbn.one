/**
 * Stand-in for the Workers runtime's `cloudflare:workers`, so `deno check`
 * can type-check `env.workers.ts` — the one file whose code only ever runs on
 * Cloudflare, and which nothing else checks.
 *
 * It is reached only through the import-map entry in this package's
 * `deno.json`. The Workers build never sees it: `env.workers.ts` is resolved
 * there by esbuild, which uses the real module. Nothing that Deno bundles may
 * import `cloudflare:workers`, or this empty object would ship in its place.
 */

export const env: Record<string, unknown> = {};
