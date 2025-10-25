import { idpOrigin } from "../../server/config.ts";
import * as esbuild from "esbuild";
import { denoPlugin } from "@deno/esbuild-plugin";
import { fromFileUrl, join } from "@std/path";

if(Deno.env.get("DENO_DEPLOY")){
  // https://docs.deno.com/deploy/reference/env_vars_and_contexts/#predefined-environment-variables
  const DENO_DEPLOY_ORG_SLUG = Deno.env.get("DENO_DEPLOY_ORG_SLUG");
  const DENO_DEPLOY_APP_SLUG = Deno.env.get("DENO_DEPLOY_APP_SLUG");
  const DENO_DEPLOY_BUILD_ID = Deno.env.get("DENO_DEPLOY_BUILD_ID");
  const PREVIEW_URL = `https://${DENO_DEPLOY_APP_SLUG}-${DENO_DEPLOY_BUILD_ID}.${DENO_DEPLOY_ORG_SLUG}.deno.net/`
  console.log(Deno.env.toObject());
  console.log({PREVIEW_URL})
}

const resolvePath = (relativePath: string) =>
  fromFileUrl(new URL(relativePath, import.meta.url));

const entryPoint = resolvePath("../src/client.ts");
const distDir = resolvePath("../_dist");
const outFile = join(distDir, "client.js");

try {
  await Deno.mkdir(distDir, { recursive: true });
  await esbuild.initialize({});

  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "browser",
    plugins: [denoPlugin()],
    target: ["es2022"],
    outfile: outFile,
    treeShaking: true,
    define: {
      PASSKEY_ORIGIN: JSON.stringify(idpOrigin),
    },
    write: true,
  });
} finally {
  esbuild.stop();
}
