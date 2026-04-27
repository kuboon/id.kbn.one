/**
 * Client-side JS/TSX bundling via `Deno.bundle` (unstable).
 *
 * Each entrypoint under `main/client/` is compiled to a same-named `.js`
 * (with linked sourcemap) under `main/bundled/`, served by the router via
 * `staticFiles`.
 */

const CLIENT_ENTRIES = [
  "mod.ts",
  "index.ts",
  "me.tsx",
  "authorize.ts",
  "sw.js",
] as const;

export async function buildJs(
  { minify = false, write = true }: { minify?: boolean; write?: boolean } = {},
) {
  const entrypoints = CLIENT_ENTRIES.map((p) =>
    import.meta.resolve(`../client/${p}`)
  );
  return await Deno.bundle({
    entrypoints,
    outputDir: new URL("../bundled", import.meta.url).pathname,
    platform: "browser",
    sourcemap: "linked",
    minify,
    write,
  });
}
