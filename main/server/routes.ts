import { del, get, patch, post, route } from "@remix-run/fetch-router/routes";
import webauthnRoute from "./lib/webauthn/routes.ts";

export const routes = route({
  // Pages
  home: get("/"),
  me: get("/me"),
  authorize: get("/authorize"),

  // Session management (DPoP-bound)
  session: get("/session"),
  sessionLogout: post("/session/logout"),
  bindSession: post("/bind_session"),

  // Account
  accountDelete: del("/account"),

  // Webauthn (passkeys)
  webauthn: route("webauthn", webauthnRoute),

  // Credentials
  credentials: route("credentials", {
    list: get("/"),
    update: patch("/:credentialId"),
    delete: del("/:credentialId"),
  }),

  // Push notifications
  push: route("push", {
    vapidKey: get("/vapid-key"),
    listSubscriptions: get("/subscriptions"),
    upsertSubscription: post("/subscriptions"),
    updateSubscription: patch("/subscriptions/:id"),
    deleteSubscription: del("/subscriptions/:id"),
    testNotification: post("/notifications/test"),
  }),
});
