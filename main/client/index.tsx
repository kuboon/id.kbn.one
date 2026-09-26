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
} from "@remix-run/ui";
import { createClient } from "@kuboon/passkeys";
import { init as initDpop } from "@kuboon/dpop";
import {
  detectPasskeyStatus,
  isPasskeyBlocked,
  type PasskeySupport,
  passkeySupportNotice,
  showPasskeyGuide,
} from "./lib/passkey-support.ts";

type AlertKind = "info" | "success" | "warning" | "error";

export interface IndexProps {
  [key: string]: SerializableValue;
}

const isClientEnv = typeof globalThis !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined" &&
  typeof (globalThis as { window?: unknown }).window !== "undefined";

export const Index = clientEntry(
  "/index.js#Index",
  function Index(handle: Handle<IndexProps>) {
    let status: { message: string; kind: AlertKind } = {
      message: "パスキーに対応しているか確認しています…",
      kind: "info",
    };
    let conditionalAvailable = false;
    let passkeySupport: PasskeySupport | null = null;
    const busy = { signin: false, register: false };
    let registerMode = false;
    const REGISTER_INPUT_ID = "register-username";
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

    const checkPasskeySupport = async () => {
      try {
        const status = await detectPasskeyStatus();
        passkeySupport = status.support;
        conditionalAvailable =
          status.capabilities.conditionalMediationAvailable;
        const notice = passkeySupportNotice(status.support);
        if (notice) {
          setStatus(notice.message, notice.kind);
        } else {
          setStatus(
            conditionalAvailable
              ? "このブラウザーではパスキーの自動入力が利用できます。"
              : "パスキーが利用できます。ボタンからサインインしてください。",
          );
        }
      } catch (error) {
        console.error("Failed to detect passkey support:", error);
        passkeySupport = "unsupported";
        conditionalAvailable = false;
        setStatus("パスキーに対応しているか判定できませんでした。", "error");
      }
    };

    const signIn = async () => {
      if (busy.signin || !passkeyClient) return;
      if (isPasskeyBlocked(passkeySupport)) {
        // Device-specific remedy (leave the in-app browser, or use another
        // device) — the guide walks through it.
        showPasskeyGuide();
        return;
      }
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

    const createAccount = async (rawUserId: string) => {
      if (busy.register || !passkeyClient) return;
      const userId = rawUserId.trim();
      if (!userId) {
        setStatus("ユーザー名を入力してください。", "info");
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

      await checkPasskeySupport();

      const session = await getSession();
      if (session?.userId) {
        location.href = "/me";
      }
    };

    if (isClientEnv) {
      void initialize();
    }

    return () => (
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
              {!registerMode
                ? (
                  <button
                    type="button"
                    disabled={busy.signin || busy.register}
                    class="btn btn-outline btn-block"
                    mix={[on("click", () => {
                      registerMode = true;
                      handle.update();
                    })]}
                  >
                    アカウントを作成
                  </button>
                )
                : (
                  <div class="flex flex-col gap-2">
                    <input
                      id={REGISTER_INPUT_ID}
                      type="text"
                      placeholder="ユーザー名"
                      autocomplete="username"
                      class="input input-bordered w-full"
                      disabled={busy.register}
                    />
                    <div class="flex gap-2">
                      <button
                        type="button"
                        disabled={busy.signin || busy.register}
                        class="btn btn-primary flex-1"
                        mix={[on("click", () => {
                          const input = document.getElementById(
                            REGISTER_INPUT_ID,
                          ) as HTMLInputElement | null;
                          void createAccount(input?.value ?? "");
                        })]}
                      >
                        登録
                      </button>
                      <button
                        type="button"
                        disabled={busy.register}
                        class="btn btn-ghost flex-1"
                        mix={[on("click", () => {
                          registerMode = false;
                          handle.update();
                        })]}
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                )}
            </div>

            <div role="alert" class={`alert alert-${status.kind} alert-soft`}>
              <span>{status.message}</span>
            </div>

            {isPasskeyBlocked(passkeySupport) && (
              <button
                type="button"
                class="btn btn-ghost btn-sm btn-block"
                mix={[on("click", () => {
                  showPasskeyGuide();
                })]}
              >
                パスキーを使う手順を見る
              </button>
            )}
          </div>
        </div>
      </main>
    );
  },
);
