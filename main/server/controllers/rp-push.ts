/**
 * `POST /rp/notifications` — server-to-server notification dispatch for a
 * registered RP, authenticated via a `private_key_jwt` client assertion (see
 * `middleware/rp.ts`). Unlike `POST /push/notifications` there is no browser
 * DPoP session: the RP names its targets explicitly by `userId(s)` and/or
 * `subscriptionIds`, and a registered RP may target any user.
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

/** A concrete delivery target: an owned subscription id. */
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

    const userIds = [
      ...(body.userId ? [body.userId] : []),
      ...(body.userIds ?? []),
    ];
    const subscriptionIds = body.subscriptionIds ?? [];
    if (!userIds.length && !subscriptionIds.length) {
      return errorResponse(
        400,
        "Provide at least one of userId, userIds, or subscriptionIds",
      );
    }

    const payload = toServicePayload(body.notification);

    // Resolve every target to an (owner, subscription) pair, de-duplicated by
    // subscription id so a device reachable via both a userId and an explicit
    // id is only notified once.
    const byId = new Map<string, Target>();
    for (const userId of new Set(userIds)) {
      const subs = await pushService.listSubscriptions(userId);
      for (const sub of subs) {
        byId.set(sub.id, { userId, subscriptionId: sub.id });
      }
    }
    const unknownSubscriptionIds: string[] = [];
    for (const id of new Set(subscriptionIds)) {
      if (byId.has(id)) continue;
      const sub = await pushService.getSubscriptionById(id);
      if (!sub) {
        unknownSubscriptionIds.push(id);
        continue;
      }
      byId.set(id, { userId: sub.userId, subscriptionId: id });
    }

    const targets = [...byId.values()];
    if (targets.length === 0) {
      return setNoStore(
        Response.json({ results: [], unknownSubscriptionIds }),
      );
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

    return setNoStore(Response.json({ results, unknownSubscriptionIds }));
  },
};
