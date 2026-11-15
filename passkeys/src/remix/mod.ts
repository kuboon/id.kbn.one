/**
 * Passkey actions for Remix v3 fetch-router.
 *
 * Returns a set of action handlers (registerOptions / registerVerify /
 * authenticateOptions / authenticateVerify) so callers can wire them into
 * their own `routes` map. Mirrors the behavior of the Hono variant — same
 * core, same JSON shapes.
 */

import type { RequestContext, RequestHandler } from "@remix-run/fetch-router";

/**
 * Any request context, whatever entries the surrounding middleware added. The
 * bare `RequestContext` default carries no entries and is invariant, so these
 * actions would not be mountable under a layer that adds context values (e.g.
 * a DPoP session).
 */
// Mirrors fetch-router's own internal `AnyContext`, which it does not export.
// deno-lint-ignore no-explicit-any
type AnyRequestContext = RequestContext<any, any>;
import { type } from "arktype";

import { createPasskeysCore, UserIdTakenError } from "../core/mod.ts";
import type { PasskeyRepository } from "../core/types.ts";

export interface PasskeysActionsOptions {
  rpID: string;
  rpName: string;
  storage: PasskeyRepository;
  /** Returns the currently signed-in user, if any. */
  getUserId: (context: AnyRequestContext) => string | undefined;
  /** Persists the signed-in user after successful registration / auth. */
  updateSession: (
    context: AnyRequestContext,
    userId: string,
  ) => Promise<void> | void;
}

const registerOptionsBody = type({ "displayName?": "string" });

/** Longest passkey display name taken from a request; longer ones are cut. */
const MAX_DISPLAY_NAME = 64;
const registerVerifyBody = type({
  credential: "object",
  sessionToken: "string",
});
const authenticateVerifyBody = type({
  credential: "object",
  sessionToken: "string",
});

export const getRequestUrl = (request: Request): URL => {
  const headerOrigin = request.headers.get("origin")?.trim();
  try {
    if (headerOrigin) return new URL(headerOrigin);
    return new URL(request.url);
  } catch {
    throw jsonError(400, "Unable to determine request origin");
  }
};

const jsonError = (
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): Response =>
  new Response(JSON.stringify({ message, ...extra }), {
    status,
    headers: { "content-type": "application/json" },
  });

const noStore = (response: Response): Response => {
  response.headers.set("cache-control", "no-store");
  return response;
};

const ok = <T>(body: T): Response => noStore(Response.json(body));

const validateReqBody = async <T>(
  request: Request,
  schema: { (input: unknown): T | type.errors },
): Promise<T | Response> => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const result = schema(raw);
  if (result instanceof type.errors) {
    return jsonError(400, result.summary);
  }
  return result;
};

export interface PasskeysActions {
  registerOptions: RequestHandler<AnyRequestContext>;
  registerVerify: RequestHandler<AnyRequestContext>;
  authenticateOptions: RequestHandler<AnyRequestContext>;
  authenticateVerify: RequestHandler<AnyRequestContext>;
}

export function createPasskeysActions(
  options: PasskeysActionsOptions,
): PasskeysActions {
  const { getUserId, updateSession, storage, rpID, rpName } = options;
  const core = createPasskeysCore({
    rpID,
    rpName,
    storage,
    // The core only consumes `storage` and `rpName`; session updates are
    // applied here by `createPasskeysActions` directly with the real ctx.
    getUserId: () => undefined,
    updateSession: () => undefined,
  });

  return {
    async registerOptions(context) {
      const parsed = await validateReqBody(
        context.request,
        registerOptionsBody,
      );
      if (parsed instanceof Response) return parsed;
      const sessionUserId = getUserId(context);
      // A new account's id is always ours to pick: a client-chosen one could be someone else's
      // (or a name someone else wants). Signed in, it is the account's own id.
      const userName = sessionUserId ?? crypto.randomUUID();
      const displayName =
        parsed.displayName?.trim().slice(0, MAX_DISPLAY_NAME) ||
        undefined;
      const requestUrl = getRequestUrl(context.request);
      try {
        const { optionsResult, sessionToken } = await core
          .registrationOptionsForUser({
            userName,
            requestUrl,
            signedInAs: sessionUserId,
            displayName,
          });
        return ok({ options: optionsResult, sessionToken });
      } catch (err) {
        if (err instanceof UserIdTakenError) {
          return jsonError(409, "userId is already taken");
        }
        throw err;
      }
    },

    async registerVerify(context) {
      const parsed = await validateReqBody(context.request, registerVerifyBody);
      if (parsed instanceof Response) return parsed;
      let result;
      try {
        result = await core.verifyRegistration({
          body: parsed.credential,
          sessionToken: parsed.sessionToken,
          requestUrl: getRequestUrl(context.request),
          userAgent: context.request.headers.get("user-agent") ?? undefined,
          signedInAs: getUserId(context),
        });
      } catch (err) {
        if (err instanceof UserIdTakenError) {
          return jsonError(409, "userId is already taken");
        }
        throw err;
      }
      if (!result.verified || !result.credential) {
        return jsonError(400, "Registration could not be verified");
      }
      await updateSession(context, result.credential.userId);
      return ok({ verified: result.verified });
    },

    async authenticateOptions(context) {
      const requestUrl = getRequestUrl(context.request);
      const { optionsResult, sessionToken } = await core
        .authenticationOptions({ requestUrl });
      return ok({ options: optionsResult, sessionToken });
    },

    async authenticateVerify(context) {
      const parsed = await validateReqBody(
        context.request,
        authenticateVerifyBody,
      );
      if (parsed instanceof Response) return parsed;
      try {
        const result = await core.verifyAuthentication({
          body: parsed.credential,
          sessionToken: parsed.sessionToken,
        });
        if (!result.verified || !result.credential) {
          return jsonError(400, "Authentication could not be verified");
        }
        await updateSession(context, result.credential.userId);
        return ok({ verified: result.verified });
      } catch (err) {
        if (
          err instanceof Error && "status" in err &&
          (err as { status?: number }).status === 401
        ) {
          const rpId = (err as { rpId?: unknown }).rpId;
          return jsonError(
            401,
            "Credential not found",
            typeof rpId === "string" ? { rpId } : undefined,
          );
        }
        return jsonError(400, "Authentication could not be verified");
      }
    },
  };
}

export type { PasskeyCredential, PasskeyRepository } from "../core/types.ts";
