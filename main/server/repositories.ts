/**
 * Singleton repositories shared across controllers.
 */

import { DenoKvRepo, getKvInstance } from "@kbn/kv/denoKv.ts";
import type { Session } from "@remix-run/session";

import { DenoKvPasskeyRepository } from "./repository/deno-kv-passkey-store.ts";
import type {
  StoredPushSubscription,
  UserIndexValue,
} from "./lib/push/service.ts";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export const sessionRepo = new DenoKvRepo<Session["data"]>(["dpop-session"], {
  expireIn: SESSION_TTL_MS,
});

export const credentialRepository = await (async () => {
  const kv = await getKvInstance();
  return new DenoKvPasskeyRepository(kv);
})();

export const pushSubscriptionRepo = new DenoKvRepo<StoredPushSubscription>([
  "push",
  "subscription",
]);

export const pushUserIndexRepoForUser = (
  userId: string,
): DenoKvRepo<UserIndexValue> =>
  new DenoKvRepo<UserIndexValue>(["push", "user", "subscriptions", userId]);
