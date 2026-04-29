/**
 * Sign-in landing page (/) — Remix v3 clientEntry component.
 *
 * Mirrors the structural choices of `client/me.tsx`: state lives in the
 * setup-scope closure, `handle.update()` triggers re-renders, and the
 * server emits a static loading shell that the runtime hydrates after
 * fetching the current session.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/component";
import { createClient } from "@kuboon/passkeys";
import { init as initDpop } from "@kuboon/dpop";

type AlertKind = "info" | "success" | "warning" | "error";

export interface IndexProps {
  [key: string]: SerializableValue;
}

const isClientEnv = typeof globalThis !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined" &&
  typeof (globalThis as { window?: unknown }).window !== "undefined";

export const Index = clientEntry(
  "/index.js#Index",
  function Index(handle: Handle, _setup: null) {
    let status: { message: string; kind: AlertKind } = {
      message: "パスキーの自動入力に対応しているか確認しています…",
      kind: "info",
    };
    let conditionalAvailable = false;
    const busy = { signin: false, register: false };
    let fetchDpop: typeof fetch | null = null;
    let passkeyClient: ReturnType<typeof createClient> | null = null;

    const setStatus = (message: string, kind: AlertKind = "info") => {
      status = { message, kind };
      handle.update();
    };

    const getSession = async (): Promise<{ userId?: string } | null> => {
      if (!fetchDpop) return null;
      try {
        const r = await fetchDpop("/session");
        return r.ok ? await r.json() as { userId?: string } : null;
      } catch {
        return null;
      }
    };

    const goToDashboard = async () => {
      const session = await getSession();
      if (session?.userId) {
        location.href = "/me";
        return;
      }
      throw new Error("サインインできませんでした。もう一度お試しください。");
    };

    const checkConditionalMediation = async () => {
      if (
        typeof PublicKeyCredential === "undefined" ||
        typeof PublicKeyCredential.isConditionalMediationAvailable !==
          "function"
      ) {
        conditionalAvailable = false;
        setStatus(
          "ご利用のブラウザーはまだパスキーの自動入力に対応していません。",
          "warning",
        );
        return;
      }
      try {
        const available = await PublicKeyCredential
          .isConditionalMediationAvailable();
        conditionalAvailable = available;
        setStatus(
          available
            ? "このブラウザーではパスキーの自動入力が利用できます。"
            : "パスキーの自動入力は無効です。手動でサインインできます。",
          available ? "info" : "warning",
        );
      } catch (error) {
        console.error("Failed to detect conditional mediation:", error);
        conditionalAvailable = false;
        setStatus(
          "パスキーの自動入力に対応しているか判定できませんでした。",
          "error",
        );
      }
    };

    const signIn = async () => {
      if (busy.signin || !passkeyClient) return;
      if (!conditionalAvailable) {
        setStatus(
          "このブラウザーではパスキーの自動入力が利用できません。アカウントを作成するかユーザー名でサインインしてください。",
          "info",
        );
        return;
      }
      busy.signin = true;
      handle.update();
      try {
        setStatus("パスキーの操作を待機しています…");
        await passkeyClient.authenticate();
        setStatus("サインインに成功しました。", "success");
        await goToDashboard();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(
          message
            ? `サインインに失敗しました: ${message}`
            : "サインインがキャンセルされたか失敗しました。",
          "error",
        );
        busy.signin = false;
        handle.update();
      }
    };

    const createAccount = async () => {
      if (busy.register || !passkeyClient) return;
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
        setStatus("アカウントを作成しました。", "success");
        await goToDashboard();
      } catch (error) {
        let message = "パスキーの設定に失敗しました。";
        let kind: AlertKind = "error";
        if (error instanceof DOMException) {
          switch (error.name) {
            case "NotAllowedError":
              message =
                "このデバイスには既にこのアカウントのパスキーがあります。別の認証器を使用するか既存の鍵を削除してください。";
              break;
            case "InvalidStateError":
              message =
                "この認証器は既にこのアカウントに登録されているため要求を拒否しました。";
              break;
            case "AbortError":
              message = "パスキーの設定がキャンセルされました。";
              kind = "info";
              break;
            default:
              if (error.message?.trim()) {
                message = `パスキーの設定に失敗しました: ${error.message}`;
              }
          }
        } else if (error instanceof Error && error.message.trim()) {
          message = `パスキーの設定に失敗しました: ${error.message}`;
        }
        setStatus(message, kind);
        busy.register = false;
        handle.update();
      }
    };

    const initialize = async () => {
      const dp = await initDpop();
      fetchDpop = dp.fetchDpop as unknown as typeof fetch;
      passkeyClient = createClient({ fetch: fetchDpop });

      await checkConditionalMediation();

      const session = await getSession();
      if (session?.userId) {
        location.href = "/me";
      }
    };

    if (isClientEnv) {
      void initialize();
    }

    return (_props: IndexProps) => (
      <main class="mx-auto w-full max-w-md p-6 space-y-6">
        <header class="text-center">
          <h1 class="text-3xl font-bold">kbn.one ID</h1>
        </header>

        <div class="card card-border bg-base-100 shadow-sm">
          <div class="card-body gap-4">
            <div class="flex flex-col gap-3">
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

            <div role="alert" class={`alert alert-${status.kind} alert-soft`}>
              <span>{status.message}</span>
            </div>
          </div>
        </div>
      </main>
    );
  },
);
