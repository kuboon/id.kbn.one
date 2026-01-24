import { app } from "./server/mod.ts";
import { serveBundled } from "./serveBundled.ts";

import { serveStatic } from "hono/deno";
import { HTTPException } from "hono/http-exception";

function rewriteRequestPath(path: string): string {
  switch (path) {
    case "/":
      return "/index.html";
    case "/me":
      return "/me.html";
    default:
      return path;
  }
}

const staticDir = new URL("./client", import.meta.url).pathname;
app.use(
  "*",
  serveBundled({
    root: staticDir,
    entrypoints: ["index.html", "me.html"],
    replacements: {},
    rewriteRequestPath,
  }),
);
app.use("*", serveStatic({ root: staticDir, rewriteRequestPath }));

app.onError((err, c) => {
  console.error(err);
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  return c.json({ message: "Internal Server Error" }, 500);
});

export { app };
