/**
 * Singleton repositories shared across controllers.
 *
 * Every key the app stores is declared here, so the set of prefixes is one
 * list rather than something to grep for. Which backend holds them is
 * `kv-backend.ts`'s business — Deno KV under Deno, D1 on Workers — and
 * nothing below this line can tell.
 */

import type { Session } from "@remix-run/session";
import type { PasskeyCredential } from "@kuboon/passkeys/remix";

import { createRepo } from "#server/kv-backend.ts";
import type { StoredFeedback } from "./lib/feedback/service.ts";
import type { UserProfile } from "./lib/profile.ts";
import type {
  StoredPushSubscription,
  UserIndexValue,
} from "./lib/push/service.ts";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export const sessionRepo = createRepo<Session["data"]>(["dpop-session"], {
  expireIn: SESSION_TTL_MS,
});

export const pushSubscriptionRepo = createRepo<StoredPushSubscription>([
  "push",
  "subscription",
]);

export const pushUserIndexRepoForUser = (userId: string) =>
  createRepo<UserIndexValue>(["push", "user", "subscriptions", userId]);

/**
 * Fixed-window send counters keyed by `${subscriptionId}:${windowId}`, used to
 * rate-limit notifications to a single subscription. Entries expire on their
 * own, so no cleanup is needed.
 */
export const pushRateLimitRepo = createRepo<number>(["push", "ratelimit"]);

/**
 * "Consumed" markers keyed by JWT `jti`, making OAuth authorization codes
 * single-use and giving refresh tokens rotation with reuse detection. Values
 * expire with the token, so no cleanup is needed.
 */
export const oauthConsumedRepo = createRepo<boolean>(["oauth", "consumed"]);

/**
 * Bug reports and requests from RP users, keyed by a monotonic ULID so a
 * listing comes back oldest first. Kept until deleted by hand.
 */
export const feedbackRepo = createRepo<StoredFeedback>(["feedback"]);

/** Per-user submission counters for feedback; they expire on their own. */
export const feedbackRateLimitRepo = createRepo<number>([
  "feedback_ratelimit",
]);

/** Per-user display settings, currently just the nickname. */
export const userProfileRepo = createRepo<UserProfile>(["user", "profile"]);

/** Server secrets, currently the JWS/VAPID signing key. */
export const secretRepo = createRepo<unknown>(["secret"]);

/** Passkeys by credential id — the lookup an authentication goes through. */
export const credentialRepo = createRepo<PasskeyCredential>(["credential"]);

/** The same credentials indexed per user, for listing them. */
export const userCredentialRepoForUser = (userId: string) =>
  createRepo<PasskeyCredential>(["user_credentials", userId]);

/**
 * HMAC secret for passkey challenges. It sits at the root rather than under a
 * prefix, which is where it already lives in production.
 */
export const passkeySignSecretRepo = createRepo<string>([]);
export const PASSKEY_SIGN_SECRET_KEY = "passkey_sign_secret";

/**
 * Seen DPoP proof ids. Ten minutes covers the proof's own lifetime; a marker
 * that outlived it would reject nothing that is still valid.
 */
export const dpopJtiRepo = createRepo<boolean>(["dpop_jti"], {
  expireIn: 1000 * 60 * 10,
});
