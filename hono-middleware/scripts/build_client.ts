import { idpOrigin } from "../../server/config.ts";
import { fromFileUrl } from "@std/path";

interface BundleOptions {
  entryPoint: string;
  outputDir: string;
  outputFileName?: string;
  replacements?: Record<string, string>;
}

async function bundle(options: BundleOptions): Promise<void> {
  const {
    entryPoint,
    outputDir,
    outputFileName = "bundle.js",
    replacements = {},
  } = options;

  await Deno.mkdir(outputDir, { recursive: true });

  const result = await Deno.bundle({
    entrypoints: [entryPoint],
    outputDir: outputDir,
    platform: "browser",
    minify: true,
    write: false,
  });

  if (!result.success) {
    console.error("Bundle failed:");
    for (const error of result.errors) {
      console.error(error);
    }
    Deno.exit(1);
  }

  for (const outputFile of result.outputFiles || []) {
    let content = outputFile.text();
    for (const [pattern, replacement] of Object.entries(replacements)) {
      content = content.replace(new RegExp(pattern, "g"), replacement);
    }

    await Deno.writeTextFile(outputFile.path, content);
  }
}

if (Deno.env.get("DENO_DEPLOY")) {
  // https://docs.deno.com/deploy/reference/env_vars_and_contexts/#predefined-environment-variables
  const DENO_DEPLOY_ORG_SLUG = Deno.env.get("DENO_DEPLOY_ORG_SLUG");
  const DENO_DEPLOY_APP_SLUG = Deno.env.get("DENO_DEPLOY_APP_SLUG");
  const DENO_DEPLOY_BUILD_ID = Deno.env.get("DENO_DEPLOY_BUILD_ID");
  const PREVIEW_URL =
    `https://${DENO_DEPLOY_APP_SLUG}-${DENO_DEPLOY_BUILD_ID}.${DENO_DEPLOY_ORG_SLUG}.deno.net/`;
  console.log(Deno.env.toObject());
  console.log({ PREVIEW_URL });
}

const resolvePath = (relativePath: string) =>
  fromFileUrl(new URL(relativePath, import.meta.url));

const entryPoint = resolvePath("../src/client.ts");
const distDir = resolvePath("../_dist");

await bundle({
  entryPoint,
  outputDir: distDir,
  outputFileName: "client.js",
  replacements: {
    '"{{PASSKEY_ORIGIN}}"': JSON.stringify(idpOrigin),
  },
});
