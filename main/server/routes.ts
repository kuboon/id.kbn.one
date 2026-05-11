import { del, get, patch, post, route } from "@remix-run/fetch-router/routes";
import webauthnRoute from "./lib/webauthn/routes.ts";

export const routes = route({
  // Pages (HTML, no DPoP).
  home: get("/"),
  me: get("/me"),
  authorize: get("/authorize"),

  // Public JWKS for verifiers (RFC 7517). No DPoP, no auth.
  jwks: get("/.well-known/jwks.json"),

  // OpenID Connect Discovery 1.0 metadata. No DPoP, no auth.
  openidConfiguration: get("/.well-known/openid-configuration"),

  // OIDC token endpoint — Bearer access_token + id_token issuance.
  // No DPoP (public client + PKCE per RFC 7636).
  token: post("/token"),

  // OIDC UserInfo endpoint — Bearer-authenticated.
  userinfo: get("/userinfo"),

  // `auth:` — DPoP-bound passkey + raw session ops. Logical grouping only;
  // each URL stays at its original path because `route(defs)` uses the "/"
  // base.
  auth: route({
    webauthn: route("webauthn", webauthnRoute),
  }),

  // `userApi:` — operations that require a signed-in user. Routes here see
  // `context.get(User)` (id + logout()) instead of touching DPoP directly.
  userApi: route({
    bindSession: post("/bind_session"),
    authorizeCode: post("/authorize/code"),
    accountDelete: del("/account"),

    credentials: route("credentials", {
      list: get("/"),
      update: patch("/:credentialId"),
      delete: del("/:credentialId"),
    }),
  }),
  cors: route({
    session: get("/session"),
    sessionLogout: post("/session/logout"),

    // All push endpoints are CORS-enabled so RP frontends on different
    // origins can read the VAPID public key, manage subscriptions, and
    // trigger notifications for the signed-in user.
    push: route("push", {
      vapidKey: get("/vapid-key"),
      listSubscriptions: get("/subscriptions"),
      upsertSubscription: post("/subscriptions"),
      updateSubscription: patch("/subscriptions/:id"),
      deleteSubscription: del("/subscriptions/:id"),
      testNotification: post("/notifications/test"),
      sendNotification: post("/notifications"),
    }),
  }),
});
