import { idpOrigin } from "../../server/config.ts";
import { fromFileUrl, join } from "@std/path";
import * as esbuild from "esbuild";
import { denoPlugin } from "@deno/esbuild-plugin";

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
