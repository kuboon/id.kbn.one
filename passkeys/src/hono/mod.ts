import type { PasskeyMiddlewareOptions } from "../core/types.ts";

import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type } from "arktype";
import { sValidator } from "@hono/standard-validator";

import { createPasskeysCore } from "../core/mod.ts";

const jsonError = (status: ContentfulStatusCode, message: string) =>
  new HTTPException(status, { message });

export const getRequestUrl = (c: Context): URL => {
  try {
    const headerOrigin = c.req.header("origin")?.trim();
    if (headerOrigin) {
      return new URL(headerOrigin);
    }
    return new URL(c.req.url);
  } catch {
    throw jsonError(400, "Unable to determine request origin");
  }
};

export const createPasskeysRouter = (
  options: PasskeyMiddlewareOptions,
) => {
  const { getUserId, updateSession } = options;

  const core = createPasskeysCore(options);

  const router = new Hono<
    { Variables: { session?: Record<string, unknown>; thumbprint?: string } }
  >()
    .use("*", (c, next) => {
      c.header("Cache-Control", "no-store");
      return next();
    })
    .post(
      "/register/options",
      sValidator("json", type({ "userId?": "string" })),
      async (c) => {
        const sessionUserId = getUserId(c);
        const { userId: newUserId } = c.req.valid("json");
        if (!sessionUserId && !newUserId) {
          throw jsonError(400, "userId is required");
        }
        const userName = sessionUserId || newUserId!;
        const requestUrl = getRequestUrl(c);

        const { optionsResult, sessionToken } = await core
          .registrationOptionsForUser({ userName, requestUrl });
        return c.json({ options: optionsResult, sessionToken });
      },
    )
    .post(
      "/register/verify",
      sValidator(
        "json",
        type({ "credential": "object", "sessionToken": "string" }),
      ),
      async (c) => {
        const { credential, sessionToken } = c.req.valid("json");
        const result = await core.verifyRegistration({
          body: credential as unknown,
          sessionToken,
          requestUrl: getRequestUrl(c),
          userAgent: c.req.header("user-agent"),
        });
        if (!result || !result.credential) {
          throw jsonError(400, "Registration could not be verified");
        }
        if (result.verified) {
          await updateSession(c, result.credential.userId);
        }
        return c.json({
          verified: result.verified,
        });
      },
    )
    .post("/authenticate/options", async (c) => {
      const requestUrl = getRequestUrl(c);
      const { optionsResult, sessionToken } = await core.authenticationOptions({
        requestUrl,
      });
      return c.json({ options: optionsResult, sessionToken });
    })
    .post(
      "/authenticate/verify",
      sValidator(
        "json",
        type({ "credential": "object", "sessionToken": "string" }),
      ),
      async (c) => {
        const { credential, sessionToken } = c.req.valid("json");

        try {
          const result = await core.verifyAuthentication({
            body: credential as unknown,
            sessionToken,
          });
          if (result.verified && result.credential) {
            await updateSession(c, result.credential.userId);
          }
          return c.json({
            verified: result.verified,
          });
        } catch (err: unknown) {
          if (
            err instanceof Error && "status" in err &&
            (err as unknown as { status?: number }).status === 401
          ) {
            const message = "Credential not found";
            const res = Response.json({ message });
            throw new HTTPException(401, { message, res });
          }
          throw jsonError(400, "Authentication could not be verified");
        }
      },
    );

  return router;
};

const routerForType = createPasskeysRouter({} as PasskeyMiddlewareOptions);
export type PasskeyAppType = typeof routerForType;

export * from "../core/types.ts";
