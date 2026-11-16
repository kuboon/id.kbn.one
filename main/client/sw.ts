/**
 * The service worker: shows Web Push notifications and opens their URL on
 * click, with @remix-kbn/web-push — the same handlers RP apps (and kagi) use,
 * reading the message format `lib/push/service.ts` sends.
 *
 * Bundled to `/sw.js` (`main/bundler/js.ts`) and served from the root so its
 * scope is the whole origin.
 */

import { installPushHandlers } from "@remix-kbn/web-push/sw";

installPushHandlers(self, { defaultTitle: "kbn.one" });
