/**
 * IdP authorize landing (`/authorize`) — Remix v3 clientEntry component.
 *
 * Two modes:
 *   - "dpop": simple DPoP-jkt flow used by first-party RPs. After passkey
 *     auth, POST /bind_session binds the RP's DPoP key, then
 *     `location.replace(redirectUri)` (no query params). The RP fetches
 *     `/session` with its DPoP key to get a bound JWS.
 *   - "oidc": OIDC Authorization Code flow for third-party RPs that
 *     speak standard OIDC. After passkey auth, POST /authorize/code
 *     issues a one-time code, then redirect to
 *     `redirect_uri?code=...&state=...`.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";
import { createClient } from "@kuboon/passkeys";
import { init as initDpop } from "@kuboon/dpop";

type AlertKind = "info" | "success" | "warning" | "error";

export interface AuthorizeProps {
  mode: "dpop" | "oidc";
  rpOrigin: string;
  // dpop mode
  dpopJkt?: string;
  redirectUri?: string;
  // oidc mode
  oidcClientId?: string;
  oidcRedirectUri?: string;
  oidcScope?: string;
  oidcState?: string;
  oidcNonce?: string;
  oidcCodeChallenge?: string;
  [key: string]: SerializableValue;
}

const isClientEnv = typeof globalThis !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined" &&
  typeof (globalThis as { window?: unknown }).window !== "undefined";

export const Authorize = clientEntry(
  "/authorize.js#Authorize",
  function Authorize(handle: Handle<AuthorizeProps>) {
    const props = handle.props;

    let status: { message: string; kind: AlertKind } = {
      message: "セッションを確認しています…",
      kind: "info",
    };
    let phase: "probing" | "needs-action" | "redirecting" | "error" = "probing";
    const busy = { signin: false, register: false };
    let fetchDpop: typeof fetch | null = null;
    let passkeyClient: ReturnType<typeof createClient> | null = null;

    const setStatus = (message: string, kind: AlertKind = "info") => {
      status = { message, kind };
      handle.update();
    };

    const getSession = async (): Promise<{ userId?: string | null } | null> => {
      if (!fetchDpop) return null;
      try {
        const r = await fetchDpop("/session");
        return r.ok ? await r.json() as { userId?: string | null } : null;
      } catch {
        return null;
      }
    };

    const finalizeDpop = async () => {
      if (!fetchDpop) throw new Error("DPoP not initialized");
      setStatus("セッションを連携しています…");
      const r = await fetchDpop("/bind_session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dpop_jkt: props.dpopJkt }),
      });
      if (!r.ok) {
        let message = `セッションの連携に失敗しました (HTTP ${r.status})`;
        try {
          const data = await r.json() as { message?: unknown };
          if (
            data && typeof data === "object" &&
            typeof data.message === "string"
          ) {
            message = data.message;
          }
        } catch { /* ignore */ }
        throw new Error(message);
      }
      phase = "redirecting";
      setStatus("リダイレクトしています…", "success");
      location.replace(props.redirectUri!);
    };

    const finalizeOidc = async () => {
      if (!fetchDpop) throw new Error("DPoP not initialized");
      setStatus("認可コードを発行しています…");
      const body = {
        client_id: props.oidcClientId,
        redirect_uri: props.oidcRedirectUri,
        scope: props.oidcScope,
        state: props.oidcState,
        nonce: props.oidcNonce || undefined,
        code_challenge: props.oidcCodeChallenge,
        code_challenge_method: "S256",
      };
      const r = await fetchDpop("/authorize/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        let message = `認可コードの発行に失敗しました (HTTP ${r.status})`;
        try {
          const data = await r.json() as {
            error_description?: unknown;
            message?: unknown;
          };
          if (typeof data?.error_description === "string") {
            message = data.error_description;
          } else if (typeof data?.message === "string") {
            message = data.message;
          }
        } catch { /* ignore */ }
        throw new Error(message);
      }
      const { redirect_to } = await r.json() as { redirect_to: string };
      phase = "redirecting";
      setStatus("リダイレクトしています…", "success");
      location.replace(redirect_to);
    };

    const finalize = () =>
      props.mode === "oidc" ? finalizeOidc() : finalizeDpop();

    const handleSigninError = (error: unknown, fallback: string) => {
      let message = fallback;
      if (error instanceof DOMException) {
        if (error.name === "AbortError") {
          message = "サインインがキャンセルされました。";
        } else if (error.message) {
          message = `${fallback}: ${error.message}`;
        }
      } else if (error instanceof Error && error.message) {
        message = `${fallback}: ${error.message}`;
      }
      setStatus(message, "error");
    };

    const signIn = async () => {
      if (busy.signin || busy.register || !passkeyClient) return;
      busy.signin = true;
      handle.update();
      try {
        setStatus("パスキーの操作を待機しています…");
        await passkeyClient.authenticate();
        await finalize();
      } catch (error) {
        handleSigninError(error, "サインインに失敗しました");
        busy.signin = false;
        handle.update();
      }
    };

    const createAccount = async () => {
      if (busy.signin || busy.register || !passkeyClient) return;
      const userId = prompt("パスキーに登録するユーザー名を入力してください:")
        ?.trim();
      if (!userId) {
        setStatus("ユーザー名が入力されませんでした。", "info");
        return;
      }
      busy.register = true;
      handle.update();
      try {
        setStatus("セキュリティキーの操作を待機しています…");
        await passkeyClient.register({ userId });
        await finalize();
      } catch (error) {
        handleSigninError(error, "アカウントの作成に失敗しました");
        busy.register = false;
        handle.update();
      }
    };

    const initialize = async () => {
      try {
        const dp = await initDpop();
        fetchDpop = dp.fetchDpop as unknown as typeof fetch;
        passkeyClient = createClient({ fetch: fetchDpop });

        const session = await getSession();
        if (session?.userId) {
          await finalize();
          return;
        }
        phase = "needs-action";
        setStatus("サインインしてください。");
      } catch (error) {
        phase = "error";
        handleSigninError(error, "セッションの確認に失敗しました");
      }
    };

    if (isClientEnv) {
      void initialize();
    }

    return () => (
      <main class="mx-auto w-full max-w-md p-6 space-y-6">
        <header class="text-center">
          <h1 class="text-2xl font-bold">kbn.one ID</h1>
        </header>

        <div class="card card-border bg-base-100">
          <div class="card-body gap-3">
            <div role="alert" class={`alert alert-${status.kind} alert-soft`}>
              <span>{status.message}</span>
            </div>

            {props.rpOrigin && (
              <p class="text-sm text-base-content/70">
                {props.rpOrigin} からのサインインリクエストです。
              </p>
            )}

            {phase === "needs-action" && (
              <div class="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={busy.signin || busy.register}
                  class="btn btn-primary btn-block"
                  mix={[on("click", () => {
                    void signIn();
                  })]}
                >
                  パスキーでサインイン
                </button>
                <button
                  type="button"
                  disabled={busy.signin || busy.register}
                  class="btn btn-outline btn-block"
                  mix={[on("click", () => {
                    void createAccount();
                  })]}
                >
                  アカウントを作成
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  },
);
