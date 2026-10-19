/**
 * The bundler half of the Cloudflare configuration, read by wrangler, which
 * `cf` uses to build this Worker because it is not a Vite project. Everything
 * else is in `cloudflare.config.ts`.
 */

import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
  // `deno bundle` deliberately leaves `#env` external: it is the one seam
  // between the runtimes, and under Deno the same specifier resolves to
  // `env.deno.ts` (Deno KV, static files from disk) instead.
  alias: {
    "#env": "./main/server/env.workers.ts",
  },
  // Served from the edge before the Worker is invoked, which is why the router
  // carries no static-file middleware on this runtime. A build artifact,
  // written by the same build command as the bundle.
  assetsDirectory: "./main/bundled",
});
