/**
 * RP-server middleware — authenticates server-to-server callers with a
 * `private_key_jwt` client assertion carried in the `Authorization` header:
 *
 * ```
 * Authorization: Bearer <client-assertion-jwt>
 * ```
 *
 * On success the authenticated `clientId` is exposed via the `RpClient`
 * context key. There is no browser / DPoP session here — a registered RP is
 * trusted to send notifications to any user.
 */

import type { Middleware } from "@remix-run/fetch-router";
import { createContextKey } from "@remix-run/fetch-router";

import { AuthRequiredError } from "./auth.ts";
import {
  ClientAssertionError,
  verifyClientAssertion,
} from "../lib/rp/assertion.ts";

export interface RpClient {
  readonly clientId: string;
}

export const RpClient = createContextKey<RpClient>();

type WithRpClientTransform = readonly [readonly [typeof RpClient, RpClient]];

const bearer = (request: Request): string | undefined => {
  const header = request.headers.get("authorization");
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
};

export const requireRpClient: Middleware<
  "ANY",
  Record<never, never>,
  WithRpClientTransform
> = async (context, next) => {
  const assertion = bearer(context.request);
  if (!assertion) {
    throw new AuthRequiredError("Missing client assertion");
  }
  let clientId: string;
  try {
    ({ clientId } = await verifyClientAssertion(assertion));
  } catch (error) {
    if (error instanceof ClientAssertionError) {
      throw new AuthRequiredError(error.message);
    }
    throw error;
  }
  context.set(RpClient, { clientId });
  return next();
};
