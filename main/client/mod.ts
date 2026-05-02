/**
 * Client runtime boot for the frame-based shell.
 *
 * Bundled to `bundled/mod.js` and loaded by every shell response. Hydrates
 * any clientEntry markers and wires up `<a rmx-target="content">` clicks
 * to swap just the frame body via `resolveFrame`. Each page's clientEntry
 * (Index / Me / Authorize) handles its own data fetching and rendering;
 * `loadModule` here just dynamic-imports the bundled page module.
 */

import { run } from "@remix-run/ui";

const FRAME_HEADER = "rmx-frame";

const app = run({
  async loadModule(moduleUrl: string, exportName: string) {
    const mod = await import(moduleUrl);
    return mod[exportName];
  },
  async resolveFrame(src: string, signal?: AbortSignal, target?: string) {
    const headers = new Headers({
      accept: "text/html",
      [FRAME_HEADER]: "1",
    });
    if (target) headers.set("rmx-target", target);
    const response = await fetch(src, { headers, signal });
    return response.body ?? (await response.text());
  },
});

await app.ready();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((error) => {
    console.warn("Service worker registration failed", error);
  });
}
