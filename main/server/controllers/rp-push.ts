/**
 * `POST /rp/notifications` — server-to-server notification dispatch for a
 * registered RP, authenticated via a `private_key_jwt` client assertion (see
 * `middleware/rp.ts`). There is no browser DPoP session: the RP names its
 * target users by `userIds`, and a whitelisted RP may target any user. The
 * notification is delivered to every device the named users have registered.
 */

import type { RequestContext } from "@remix-run/fetch-router";
import { type } from "arktype";

import { setNoStore } from "../middleware/auth.ts";
import { RpClient } from "../middleware/rp.ts";
import { pushService } from "../lib/push/service.ts";
import { originMatchesClient } from "../lib/rp/clients.ts";
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
    // `RpClient` (set by `requireRpClient`) is the authenticated RP origin.
    const { clientId } = context.get(RpClient);

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

    const userIds = new Set(body.userIds);
    if (userIds.size === 0) {
      return errorResponse(400, "userIds must not be empty");
    }

    const payload = toServicePayload(body.notification);

    // Expand each user to their registered devices, restricted to
    // subscriptions registered from the calling RP's own domain (or a
    // subdomain). Devices registered from other RPs are not reachable.
    const targets: Target[] = [];
    for (const userId of userIds) {
      const subs = await pushService.listSubscriptions(userId);
      for (const sub of subs) {
        if (!originMatchesClient(sub.origin, clientId)) continue;
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
          ok: !r.value.throttled,
          throttled: r.value.throttled ?? false,
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
