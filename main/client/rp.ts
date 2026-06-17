/**
 * Relying Party (RP) helper — talk to the kbn.one IdP from a third-party
 * web app.
 *
 * Wraps the DPoP key bootstrap, `/authorize` redirect, `/session` lookup,
 * and push subscription management into a single object so an RP frontend
 * can ship a sign-in + push-registration integration in a few lines:
 *
 * @example
 * ```ts
 * import { createRpClient } from "./rp.ts";
 *
 * const rp = await createRpClient({ idpOrigin: "https://id.kbn.one" });
 *
 * const session = await rp.getSession();
 * if (!session) rp.signIn();        // navigates to /authorize
 *
 * await rp.registerPush({ serviceWorkerUrl: "/sw.js" });
 * ```
 *
 * Sending notifications is server-initiated — the RP *server* calls
 * `POST /rp/notifications` (see README "RPサーバ起点の通知"), not this client.
 */

import { init as initDpop } from "@kuboon/dpop";

export interface SessionResult {
  /** Stable user id assigned by the IdP. */
  userId: string;
  /** Compact JWS signed by the IdP — verify with `/.well-known/jwks.json`. */
  jws: string;
}

export interface RpClientOptions {
  /** IdP origin, e.g. `"https://id.kbn.one"`. Must include scheme, no path. */
  idpOrigin: string;
}

export interface SignInOptions {
  /** Where the IdP should redirect back to. Defaults to `location.href`. */
  redirectUri?: string;
}

export interface RegisterPushOptions {
  /** Path to the RP's service worker script. Defaults to `"/sw.js"`. */
  serviceWorkerUrl?: string;
  /** Free-form metadata stored alongside the subscription on the IdP. */
  metadata?: Record<string, unknown>;
}

export interface RpClient {
  /** RFC 7638 thumbprint of the RP's DPoP public key. */
  readonly thumbprint: string;
  /** DPoP-aware fetch — call directly for endpoints not covered here. */
  readonly fetchDpop: typeof fetch;

  /**
   * Navigate the browser to `IdP/authorize`. Never returns; the page is
   * unloaded.
   */
  signIn(opts?: SignInOptions): never;

  /**
   * Read the IdP session bound to this DPoP key. Returns `null` when no
   * user has been bound yet (call {@link signIn} to start one).
   */
  getSession(): Promise<SessionResult | null>;

  /** Clear the IdP-side session bound to this DPoP key. */
  signOut(): Promise<void>;

  /**
   * Subscribe the current device for Web Push and register the subscription
   * with the IdP. Requires `serviceWorker` + `PushManager` + a `granted`
   * notification permission (the helper requests permission if needed).
   */
  registerPush(opts?: RegisterPushOptions): Promise<{ id: string }>;
}

const trimTrailingSlash = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;

const expectOk = async (response: Response, what: string): Promise<void> => {
  if (response.ok) return;
  let detail = "";
  try {
    const data = await response.clone().json() as { message?: string };
    if (typeof data?.message === "string") detail = `: ${data.message}`;
  } catch {
    try {
      const text = await response.text();
      if (text.trim()) detail = `: ${text.trim()}`;
    } catch { /* ignore */ }
  }
  throw new Error(`${what} failed (HTTP ${response.status})${detail}`);
};

/**
 * Build an {@link RpClient}. The DPoP key pair is created lazily and
 * persisted in IndexedDB, so subsequent page loads share the same session
 * binding.
 */
export const createRpClient = async (
  opts: RpClientOptions,
): Promise<RpClient> => {
  const idpOrigin = trimTrailingSlash(opts.idpOrigin);
  const { fetchDpop, thumbprint } = await initDpop();

  const idp = (path: string): string => `${idpOrigin}${path}`;

  const baseInit: RequestInit = { credentials: "include" };

  const signIn: RpClient["signIn"] = (signInOpts = {}) => {
    const redirectUri = signInOpts.redirectUri ?? globalThis.location?.href;
    if (!redirectUri) {
      throw new Error("redirectUri is required outside of a browser context");
    }
    const url = new URL("/authorize", idpOrigin);
    url.searchParams.set("dpop_jkt", thumbprint);
    url.searchParams.set("redirect_uri", redirectUri);
    globalThis.location.assign(url.toString());
    // location.assign aborts the current document; satisfy `never`.
    throw new Error("navigation pending");
  };

  const getSession = async (): Promise<SessionResult | null> => {
    const response = await fetchDpop(idp("/session"), baseInit);
    if (response.status === 401) return null;
    await expectOk(response, "GET /session");
    const data = await response.json() as Partial<SessionResult>;
    if (!data?.userId || !data?.jws) return null;
    return { userId: data.userId, jws: data.jws };
  };

  const signOut = async (): Promise<void> => {
    const response = await fetchDpop(idp("/session/logout"), {
      ...baseInit,
      method: "POST",
    });
    await expectOk(response, "POST /session/logout");
  };

  const registerPush = async (
    pushOpts: RegisterPushOptions = {},
  ): Promise<{ id: string }> => {
    if (
      typeof navigator === "undefined" || !("serviceWorker" in navigator) ||
      typeof PushManager === "undefined" || typeof Notification === "undefined"
    ) {
      throw new Error("Web Push is not available in this environment");
    }

    const vapidResp = await fetchDpop(idp("/push/vapid-key"), baseInit);
    await expectOk(vapidResp, "GET /push/vapid-key");
    const { publicKey } = await vapidResp.json() as { publicKey?: string };
    if (!publicKey) throw new Error("IdP returned no VAPID public key");

    const swUrl = pushOpts.serviceWorkerUrl ?? "/sw.js";
    let registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      registration = await navigator.serviceWorker.register(swUrl);
    }
    registration = await navigator.serviceWorker.ready;

    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notification permission was not granted");
      }
    } else if (Notification.permission !== "granted") {
      throw new Error("Notification permission was not granted");
    }

    const subscription = await registration.pushManager.getSubscription() ??
      await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });

    const response = await fetchDpop(idp("/push/subscriptions"), {
      ...baseInit,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        metadata: pushOpts.metadata,
      }),
    });
    await expectOk(response, "POST /push/subscriptions");
    const data = await response.json() as { subscription?: { id?: string } };
    if (!data?.subscription?.id) {
      throw new Error("IdP did not return a subscription id");
    }
    return { id: data.subscription.id };
  };

  return {
    thumbprint,
    fetchDpop,
    signIn,
    getSession,
    signOut,
    registerPush,
  };
};
