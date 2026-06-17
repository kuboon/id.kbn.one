/**
 * `POST /rp/notifications` — server-to-server notification dispatch for a
 * registered RP, authenticated via a `private_key_jwt` client assertion (see
 * `middleware/rp.ts`). There is no browser DPoP session: the RP names its
 * target users by `userId` / `userIds`, and a registered RP may target any
 * user. The notification is delivered to every device the named users have
 * registered.
 */

import type { RequestContext } from "@remix-run/fetch-router";
import { type } from "arktype";

import { setNoStore } from "../middleware/auth.ts";
import { RpClient } from "../middleware/rp.ts";
import { pushService } from "../lib/push/service.ts";
import { rpSendNotificationBodySchema } from "../lib/push/schemas.ts";
import {
  mapWithConcurrency,
  MAX_NOTIFICATION_TARGETS,
  PUSH_SEND_CONCURRENCY,
  toServicePayload,
} from "../lib/push/dispatch.ts";

const errorResponse = (status: number, message: string): Response =>
  Response.json({ message }, { status });

/** A concrete delivery target: one user's subscription. */
interface Target {
  userId: string;
  subscriptionId: string;
}

export const rpPushController = {
  async sendNotification(context: RequestContext) {
    // `RpClient` is set by `requireRpClient`; reading it asserts the route is
    // wired behind that middleware.
    context.get(RpClient);

    let raw: unknown;
    try {
      raw = await context.request.json();
    } catch {
      return errorResponse(400, "Invalid JSON body");
    }
    const body = rpSendNotificationBodySchema(raw);
    if (body instanceof type.errors) {
      return errorResponse(400, body.summary);
    }

    const userIds = new Set([
      ...(body.userId ? [body.userId] : []),
      ...(body.userIds ?? []),
    ]);
    if (userIds.size === 0) {
      return errorResponse(400, "Provide at least one of userId or userIds");
    }

    const payload = toServicePayload(body.notification);

    // Expand each user to their registered devices.
    const targets: Target[] = [];
    for (const userId of userIds) {
      const subs = await pushService.listSubscriptions(userId);
      for (const sub of subs) {
        targets.push({ userId, subscriptionId: sub.id });
      }
    }

    if (targets.length === 0) {
      return setNoStore(Response.json({ results: [] }));
    }
    if (targets.length > MAX_NOTIFICATION_TARGETS) {
      return errorResponse(
        400,
        `Too many targets: ${targets.length} (max ${MAX_NOTIFICATION_TARGETS})`,
      );
    }

    const settled = await mapWithConcurrency(
      targets,
      PUSH_SEND_CONCURRENCY,
      (t) => pushService.sendNotification(t.userId, t.subscriptionId, payload),
    );

    const results = settled.map((r, i) =>
      r.status === "fulfilled"
        ? {
          userId: targets[i].userId,
          subscriptionId: targets[i].subscriptionId,
          ok: true,
          removed: r.value.removed ?? false,
          warnings: r.value.warnings ?? [],
        }
        : {
          userId: targets[i].userId,
          subscriptionId: targets[i].subscriptionId,
          ok: false,
          error: r.reason instanceof Error
            ? r.reason.message
            : String(r.reason),
        }
    );

    return setNoStore(Response.json({ results }));
  },
};
