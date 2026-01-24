import { fromFileUrl } from "@std/path";

const resolvePath = (relativePath: string) =>
  fromFileUrl(new URL(relativePath, import.meta.url));
const result = await Deno.bundle({
  entrypoints: [resolvePath("../static/client.ts")],
  outputDir: resolvePath("../static"),
  platform: "browser",
  sourcemap: "linked",
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
  const content = outputFile.text();
  await Deno.writeTextFile(outputFile.path, content);
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
