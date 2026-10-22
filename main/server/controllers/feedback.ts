/**
 * POST /feedback — a bug report or request from a signed-in user, sent from
 * an RP's page through the `cors:` layer.
 *
 * Who sent it and from where come from the request itself: the user from the
 * DPoP session, the RP from the browser-set `Origin` header, which page
 * script cannot forge. The body only carries what the user wrote.
 */

import { type } from "arktype";

import type { CorsContext } from "../middlewares.ts";
import { feedbackNotifyUserIds, idpOrigin } from "../config.ts";
import { setNoStore } from "../middleware/auth.ts";
import { User } from "../middleware/user.ts";
import { callerIsIdp } from "../lib/rp/clients.ts";
import { getPushService } from "../lib/push/service.ts";
import { PushRateLimiter } from "../lib/push/rate-limit.ts";
import {
  FeedbackService,
  notificationFor,
  ownerNotifier,
} from "../lib/feedback/service.ts";
import { feedbackBodySchema } from "../lib/feedback/schemas.ts";
import { feedbackRateLimitRepo, feedbackRepo } from "../repositories.ts";

/** Per user: plenty for someone reporting real problems, not for a script. */
const FEEDBACK_LIMIT = 5;
const FEEDBACK_WINDOW_MS = 60 * 60 * 1000;

// Building this does no I/O — the repositories and the push service are all
// reached on first use — so it is safe at module scope on Workers.
const feedbackService = new FeedbackService({
  repo: feedbackRepo,
  // The push limiter is a plain fixed-window counter over any key; here the
  // key is the sender's user id.
  limiter: new PushRateLimiter(
    feedbackRateLimitRepo,
    FEEDBACK_LIMIT,
    FEEDBACK_WINDOW_MS,
  ),
  notify: ownerNotifier({
    ownerIds: feedbackNotifyUserIds,
    isIdpSubscription: (origin) => callerIsIdp(origin, idpOrigin),
    listSubscriptions: async (userId) =>
      await (await getPushService()).listSubscriptions(userId),
    send: async (userId, subscriptionId, feedback) =>
      await (await getPushService()).sendNotification(
        userId,
        subscriptionId,
        notificationFor(feedback),
      ),
  }),
});

const errorResponse = (status: number, message: string): Response =>
  Response.json({ message }, { status });

const requestOrigin = (request: Request): string | undefined => {
  const raw = request.headers.get("origin");
  if (!raw) return undefined;
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
};

const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

export const submitFeedbackAction = async (
  context: CorsContext,
): Promise<Response> => {
  const { id: userId } = context.get(User);

  let raw: unknown;
  try {
    raw = await context.request.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }
  const body = feedbackBodySchema(raw);
  if (body instanceof type.errors) return errorResponse(400, body.summary);

  const message = body.message.trim();
  if (!message) return errorResponse(400, "message must not be blank");
  if (body.pageUrl !== undefined && !isHttpUrl(body.pageUrl)) {
    return errorResponse(400, "pageUrl must be an http(s) URL");
  }

  const result = await feedbackService.submit({
    kind: body.kind,
    message,
    userId,
    origin: requestOrigin(context.request),
    pageUrl: body.pageUrl,
  });
  if (!result.ok) {
    return setNoStore(errorResponse(
      429,
      `Too many reports; at most ${FEEDBACK_LIMIT} per hour`,
    ));
  }
  return setNoStore(
    Response.json({ id: result.feedback.id }, { status: 201 }),
  );
};
