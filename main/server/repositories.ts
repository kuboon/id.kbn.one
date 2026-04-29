/**
 * Singleton repositories shared across controllers.
 */

import { DenoKvRepo, getKvInstance } from "@kbn/kv/denoKv.ts";
import type { Session } from "@remix-run/session";

import type {
  StoredPushSubscription,
  UserIndexValue,
} from "./lib/push/service.ts";

export const kv = await getKvInstance();

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export const sessionRepo = new DenoKvRepo<Session["data"]>(["dpop-session"], {
  expireIn: SESSION_TTL_MS,
});

export const pushSubscriptionRepo = new DenoKvRepo<StoredPushSubscription>([
  "push",
  "subscription",
]);

export const pushUserIndexRepoForUser = (
  userId: string,
): DenoKvRepo<UserIndexValue> =>
  new DenoKvRepo<UserIndexValue>(["push", "user", "subscriptions", userId]);
