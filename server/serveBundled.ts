import { MiddlewareHandler } from "hono/types";
import { contentType } from "@std/media-types";
import { HTTPException } from "hono/http-exception";

type BundleOptions = {
  root: string;
  entrypoints: string[];
  replacements?: Record<string, string>;
  rewriteRequestPath?: (path: string) => string;
};
type BundleResult = {
  contentType: string;
  content: string;
};
type BundleResults = Record<string, BundleResult>;
export function serveBundled(
  bundleOptions: BundleOptions,
): MiddlewareHandler {
  const bundlePromise = getBundleResults(bundleOptions);
  let { rewriteRequestPath } = bundleOptions;
  rewriteRequestPath ||= (path) => path;
  return async (c, next) => {
    const bundled = await bundlePromise;
    if (bundled === "fail") {
      throw new HTTPException(500, { message: "Bundling failed" });
    }
    const path = rewriteRequestPath(c.req.path);
    if (bundled[path]) {
      const result = bundled[path];
      c.header("Content-Type", result.contentType);
      return c.body(result.content);
    }
    return next();
  };
  async function getBundleResults(
    options: BundleOptions,
  ): Promise<BundleResults | "fail"> {
    const { root, entrypoints, replacements = {} } = options;
    const bundled = await Deno.bundle({
      entrypoints: entrypoints.map((p) => `${root}/${p}`),
      outputDir: "/",
      platform: "browser",
      sourcemap: "linked",
      minify: true,
      write: false,
    });
    if (!bundled.success) {
      console.error("Bundle failed:");
      for (const error of bundled.errors) {
        console.error(error);
      }
      return "fail";
    }
    const results: BundleResults = {};
    for (const outputFile of bundled.outputFiles || []) {
      let content = outputFile.text();
      for (const [pattern, replacement] of Object.entries(replacements)) {
        content = content.replace(new RegExp(pattern, "g"), replacement);
      }
      const ext = outputFile.path.split(".").pop() || "";
      const mime = contentType(ext) || "application/octet-stream";
      results[outputFile.path] = {
        contentType: mime,
        content,
      };
    }
    return results;
  }
}
