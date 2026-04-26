import { DenoKvPasskeyRepository } from "./repository/deno-kv-passkey-store.ts";
import { DenoKvSessionRepository } from "./repository/deno-kv-session-store.ts";
import { DenoKvJtiStore } from "./repository/deno-kv-jti-store.ts";
import { getKvInstance } from "./kvInstance.ts";
import { PushService } from "./push/service.ts";
import { createPushRouter } from "./push/router.ts";
import { createCredentialsRouter } from "./credentials/router.ts";
import {
  authorizeWhitelist,
  idpOrigin,
  pushContact,
  rpID,
  rpName,
} from "./config.ts";
import { createDpopSessionMiddleware } from "./dpop-session-middleware.ts";

import { createPasskeysRouter } from "@kuboon/passkeys/hono-middleware";

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { sValidator } from "@hono/standard-validator";
import { type } from "arktype";

const kv = await getKvInstance();
const credentialRepository = new DenoKvPasskeyRepository(kv);
const sessionRepository = new DenoKvSessionRepository(kv);
const jtiStore = new DenoKvJtiStore(kv);
const pushService = await PushService.create(kv);

const allowedOrigins = (reqOrigin: string) => {
  if (reqOrigin === idpOrigin) return reqOrigin;
  for (const origin of authorizeWhitelist) {
    if (reqOrigin === origin || reqOrigin.endsWith("." + origin)) {
      return reqOrigin;
    }
  }
};
const setNoStore = (c: Context) => {
  c.header("Cache-Control", "no-store");
};

const ensureAuthenticatedUser = (c: Context): string => {
  const userId = c.var.session?.userId;
  if (!userId) throw new HTTPException(401, { message: "Sign-in required" });
  return userId;
};

const jktPattern = /^[A-Za-z0-9_-]{43}$/;

const bindSessionBodySchema = type({
  dpop_jkt: jktPattern,
});

const isAllowedRedirectUri = (redirectUri: string): boolean => {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  return authorizeWhitelist.some((x) =>
    url.hostname === x || url.hostname.endsWith("." + x)
  );
};

const app = new Hono()
  .use(secureHeaders())
  .use(cors({ origin: allowedOrigins }))
  .use(createDpopSessionMiddleware({
    sessionStore: sessionRepository,
    checkReplay: (jti) => jtiStore.checkReplay(jti),
  }))
  .post("/session/logout", (c) => {
    setNoStore(c);
    c.set("session", undefined);
    return c.json({ success: true });
  })
  .get("/authorize", (c, next) => {
    const dpopJkt = c.req.query("dpop_jkt");
    const redirectUri = c.req.query("redirect_uri");
    if (!dpopJkt || !jktPattern.test(dpopJkt)) {
      throw new HTTPException(400, { message: "Invalid dpop_jkt" });
    }
    if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
      throw new HTTPException(400, {
        message: "redirect_uri is missing or not allowed",
      });
    }
    return next();
  })
  .use((c, next) => {
    const acceptsJson = c.req.header("accept")?.includes(
      "application/json",
    );
    if (acceptsJson && !c.var.thumbprint) {
      throw new HTTPException(401, { message: "Invalid DPoP proof" });
    }
    return next();
  })
  .post(
    "/bind_session",
    sValidator("json", bindSessionBodySchema),
    async (c) => {
      setNoStore(c);
      const userId = ensureAuthenticatedUser(c);
      const { dpop_jkt: rpJkt } = c.req.valid("json");
      await sessionRepository.update(rpJkt, () => ({ userId }));
      return c.json({ success: true });
    },
  )
  .route(
    "/webauthn",
    createPasskeysRouter({
      rpID,
      rpName,
      storage: credentialRepository,
      getUserId: (c) => c.var.session?.userId,
      updateSession: (c, userId) => {
        const thumbprint = c.var.thumbprint;
        if (!thumbprint) return;
        return sessionRepository.update(thumbprint, (current) => ({
          ...(current ?? {}),
          userId,
        }));
      },
    }),
  )
  .get("/session", (c) => {
    return c.json({ userId: c.var.session?.userId || null });
  })
  .route(
    "/credentials",
    createCredentialsRouter({
      credentialStore: credentialRepository,
      ensureAuthenticatedUser,
      setNoStore,
    }),
  )
  .delete("/account", async (c) => {
    setNoStore(c);
    const userId = ensureAuthenticatedUser(c);
    await credentialRepository.deleteCredentialsByUserId(userId);
    c.set("session", undefined);
    return c.json({ success: true });
  })
  .route(
    "/push",
    createPushRouter({
      pushService,
      pushContact,
      ensureAuthenticatedUser,
      setNoStore,
    }),
  );

export { app };
