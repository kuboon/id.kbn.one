import { app } from "./hono.ts";

export default { fetch: app.fetch };

console.log("deno serve started.");
