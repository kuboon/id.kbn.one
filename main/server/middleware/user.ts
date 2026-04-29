/**
 * User middleware — extracts the signed-in user from the DPoP session and
 * exposes it as a context key. Routes under the `userApi:` group should
 * depend on `User`, not `DpopSession`.
 *
 * Throws `AuthRequiredError` (caught by the root error handler) when no
 * valid DPoP-bound user is present.
 */

import type { Middleware } from "@remix-run/fetch-router";
import { createContextKey } from "@remix-run/fetch-router";

import { AuthRequiredError } from "./auth.ts";
import { DpopSession, sessionUserId } from "./dpop.ts";

/**
 * The signed-in user, as seen by `userApi:` routes. `logout()` clears the
 * userId on the bound DPoP session — userApi handlers never have to import
 * `DpopSession` directly.
 */
export interface User {
  readonly id: string;
  logout(): void;
}

export const User = createContextKey<User>();

type WithUserContextTransform = readonly [readonly [typeof User, User]];

export const requireUser: Middleware<
  "ANY",
  Record<never, never>,
  WithUserContextTransform
> = (context, next) => {
  if (!context.has(DpopSession)) {
    throw new AuthRequiredError("Invalid DPoP proof");
  }
  const session = context.get(DpopSession);
  const userId = sessionUserId(session);
  if (!userId) throw new AuthRequiredError();
  context.set(User, {
    id: userId,
    logout: () => session.unset("userId"),
  });
  return next();
};
