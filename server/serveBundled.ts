import { MiddlewareHandler } from "hono/types";
import { contentType } from "@std/media-types";

type BundleOptions = {
  baseDir?: string;
  entryPoints: string[];
  replacements?: Record<string, string>;
  rewriteRequestPath?: (path: string) => string;
};
type BundleResult = {
  contentType: string;
  content: string;
  sourceMap?: string;
};
type BundleResults = Record<string, BundleResult>;
export function serveBundled(
  bundleOptions: BundleOptions,
): MiddlewareHandler {
  let bundled: BundleResults | "fail" | null = null;
  const { entryPoints, rewriteRequestPath } = bundleOptions;
  return async (c, next) => {
    const path = rewriteRequestPath ? rewriteRequestPath(c.req.path) : c.req.path;
    if (!bundled && entryPoints.some((x) => path === `/${x}`)) {
      bundled = await getBundleResults(bundleOptions);
    }
    if (!bundled) return next();
    if (bundled === "fail") {
      return c.text("Internal Server Error", 500);
    }
    if (bundled[path]) {
      const result = bundled[path];
      c.header("Content-Type", result.contentType);
      if (result.sourceMap) {
        c.header("SourceMap", result.sourceMap);
      }
      return c.body(result.content);
    }
    return next();
  };
  async function getBundleResults(
    options: BundleOptions,
  ): Promise<BundleResults | "fail"> {
    const { baseDir = "./static", entryPoints, replacements = {} } = options;
    const bundled = await Deno.bundle({
      entrypoints: entryPoints.map((p) => `${baseDir}/${p}`),
      outputDir: "/",
      platform: "browser",
      sourcemap: "external",
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
      if (ext === "js" || ext === "mjs") {
        const mapFilePath = `${outputFile.path}.map`;
        const mapFile = bundled.outputFiles?.find((f) =>
          f.path === mapFilePath
        );
        if (mapFile) {
          results[outputFile.path].sourceMap = mapFilePath;
        }
      }
    }
    return results;
  }
}
