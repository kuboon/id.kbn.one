/**
 * Tailwind CSS build via `@kuboon/tailwindcss-deno` + daisyui plugin.
 *
 * Compiles `main/assets/style.css` (which `@import`s tailwindcss) into
 * `main/bundled/style.css`, scanning the `main/server` and `main/client`
 * trees for class candidates.
 */

import { compile, optimize } from "@kuboon/tailwindcss-deno";
import { Scanner } from "@tailwindcss/oxide";

const MAIN_ROOT = new URL("..", import.meta.url).pathname;
const INPUT = new URL("../assets/style.css", import.meta.url).pathname;
const OUTPUT = new URL("../bundled/style.css", import.meta.url).pathname;

export async function buildCss(
  { minify = false }: { minify?: boolean } = {},
) {
  const scanner = new Scanner({
    sources: [
      { base: `${MAIN_ROOT}server`, pattern: "**/*", negated: false },
      { base: `${MAIN_ROOT}client`, pattern: "**/*", negated: false },
    ],
  });
  const candidates = scanner.scan();

  const input = await Deno.readTextFile(INPUT);
  const compiler = await compile(input, {
    base: MAIN_ROOT,
    from: INPUT,
    onDependency: () => {},
    customCssResolver: (id) => {
      if (id === "tailwindcss/index.css") {
        const pathname = new URL(import.meta.resolve(id)).pathname;
        return Promise.resolve(pathname);
      }
      return Promise.resolve(undefined);
    },
  });

  const built = compiler.build(candidates);
  const { code } = optimize(built, { minify, file: OUTPUT });

  await Deno.mkdir(new URL("../bundled", import.meta.url), { recursive: true });
  await Deno.writeTextFile(OUTPUT, code);
  return { output: OUTPUT, bytes: code.length };
}
