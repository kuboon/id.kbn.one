/**
 * Build entrypoint: runs the JS bundler and the Tailwind/daisyui CSS
 * compiler in parallel, both writing into `main/bundled/`.
 *
 * Also mirrors static assets that don't need bundling (manifest, icons)
 * into the same directory so a single `staticFiles` middleware can serve
 * everything.
 */

import { copy, ensureDir } from "@std/fs";
import { buildCss } from "./css.ts";
import { buildJs } from "./js.ts";

export { buildCss, buildJs };

const BUNDLED = new URL("../bundled", import.meta.url).pathname;
const CLIENT = new URL("../client", import.meta.url).pathname;

async function copyStaticAssets() {
  await ensureDir(BUNDLED);
  await copy(`${CLIENT}/manifest.json`, `${BUNDLED}/manifest.json`, {
    overwrite: true,
  });
  await copy(`${CLIENT}/icons`, `${BUNDLED}/icons`, { overwrite: true });
}

if (import.meta.main) {
  const [js, css] = await Promise.all([
    buildJs(),
    buildCss(),
    copyStaticAssets(),
  ]);
  console.log("[bundler] js complete", js);
  console.log("[bundler] css complete", css);
  console.log("[bundler] static assets copied");
}
