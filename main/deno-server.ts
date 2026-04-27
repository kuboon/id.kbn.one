import router from "./server/router.ts";

export default { fetch: router.fetch.bind(router) };

console.log("deno serve started.");
