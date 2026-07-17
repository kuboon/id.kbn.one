/**
 * OAuth consent page (`/oauth/authorize`) — Remix v3 clientEntry.
 *
 * The server has already validated the request and resolved the CIMD client;
 * it passes the display fields plus a signed `requestToken`. This component
 * signs the user in with a passkey (reusing the IdP DPoP flow), shows a
 * consent prompt, and on approval posts to `/oauth/authorize/approve` — then
 * redirects the browser to the URL the server returns (client callback with
 * `code`, or `error=access_denied`).
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

export interface OAuthAuthorizeProps {
  clientName: string;
  resource: string;
  scope: string;
  requestToken: string;
  redirectOrigin: string;
  [key: string]: SerializableValue;
}

const isClientEnv = typeof globalThis !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined";

export const OAuthAuthorize = clientEntry(
  "/oauth-authorize.js#OAuthAuthorize",
  function OAuthAuthorize(handle: Handle<OAuthAuthorizeProps>) {
    const { clientName, resource, scope, requestToken, redirectOrigin } =
      handle.props;

    let status: { message: string; kind: AlertKind } = {
      message: "セッションを確認しています…",
      kind: "info",
    };
    let phase: "probing" | "needs-login" | "consent" | "working" | "error" =
      "probing";
    const busy = { signin: false, register: false, decision: false };
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

    const decide = async (decision: "approve" | "deny") => {
      if (!fetchDpop || busy.decision) return;
      busy.decision = true;
      phase = "working";
      setStatus(
        decision === "approve" ? "承認しています…" : "拒否しています…",
      );
      try {
        const r = await fetchDpop("/oauth/authorize/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request_token: requestToken, decision }),
        });
        if (!r.ok) {
          let message = `処理に失敗しました (HTTP ${r.status})`;
          try {
            const data = await r.json() as { message?: unknown };
            if (typeof data?.message === "string") message = data.message;
          } catch { /* ignore */ }
          throw new Error(message);
        }
        const { redirect } = await r.json() as { redirect: string };
        setStatus("リダイレクトしています…", "success");
        location.replace(redirect);
      } catch (error) {
        busy.decision = false;
        phase = "consent";
        setStatus(
          error instanceof Error ? error.message : "処理に失敗しました",
          "error",
        );
      }
    };

    const afterLogin = () => {
      phase = "consent";
      setStatus("アクセスを許可しますか？");
    };

    const handleError = (error: unknown, fallback: string) => {
      let message = fallback;
      if (error instanceof DOMException && error.name === "AbortError") {
        message = "操作がキャンセルされました。";
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
        afterLogin();
      } catch (error) {
        handleError(error, "サインインに失敗しました");
      } finally {
        busy.signin = false;
        handle.update();
      }
    };

    const createAccount = async () => {
      if (busy.signin || busy.register || !passkeyClient) return;
      const userId = prompt("パスキーに登録するユーザー名を入力してください:")
        ?.trim();
      if (!userId) return;
      busy.register = true;
      handle.update();
      try {
        setStatus("セキュリティキーの操作を待機しています…");
        await passkeyClient.register({ userId });
        afterLogin();
      } catch (error) {
        handleError(error, "アカウントの作成に失敗しました");
      } finally {
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
          afterLogin();
        } else {
          phase = "needs-login";
          setStatus("続けるにはサインインしてください。");
        }
      } catch (error) {
        phase = "error";
        handleError(error, "セッションの確認に失敗しました");
      }
    };

    if (isClientEnv) void initialize();

    return () => (
      <main class="mx-auto w-full max-w-md p-6 space-y-6">
        <header class="text-center">
          <h1 class="text-2xl font-bold">kbn.one ID</h1>
        </header>

        <div class="card card-border bg-base-100">
          <div class="card-body gap-3">
            <p class="text-sm">
              <span class="font-semibold">{clientName}</span>{" "}
              が次のリソースへのアクセスを要求しています:
            </p>
            <ul class="text-sm text-base-content/70 list-disc pl-5">
              <li>リソース: {resource}</li>
              <li>スコープ: {scope}</li>
              <li>戻り先: {redirectOrigin}</li>
            </ul>

            <div role="alert" class={`alert alert-${status.kind} alert-soft`}>
              <span>{status.message}</span>
            </div>

            {phase === "needs-login" && (
              <div class="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={busy.signin || busy.register}
                  class="btn btn-primary btn-block"
                  mix={[on("click", () => void signIn())]}
                >
                  パスキーでサインイン
                </button>
                <button
                  type="button"
                  disabled={busy.signin || busy.register}
                  class="btn btn-outline btn-block"
                  mix={[on("click", () => void createAccount())]}
                >
                  アカウントを作成
                </button>
              </div>
            )}

            {phase === "consent" && (
              <div class="flex gap-2">
                <button
                  type="button"
                  disabled={busy.decision}
                  class="btn btn-primary flex-1"
                  mix={[on("click", () => void decide("approve"))]}
                >
                  許可
                </button>
                <button
                  type="button"
                  disabled={busy.decision}
                  class="btn btn-ghost flex-1"
                  mix={[on("click", () => void decide("deny"))]}
                >
                  拒否
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  },
);
