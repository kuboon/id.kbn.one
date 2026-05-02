/**
 * /me page — Remix v3 clientEntry component.
 *
 * Replaces the old imperative `me.ts` (which built each list row from a
 * `<template>` element). `<template>` inside a frame fragment trips a
 * `renderToStream` issue, and templates are no longer needed once the page
 * itself is a clientEntry: every dynamic row is rendered from JSX with
 * `account.credentials.map(...)` / `pushManager.state.subscriptions.map(...)`.
 *
 * The component is rendered server-side in a `phase = "loading"` state so
 * the user gets an immediate shell. On the client, `setup` kicks off the
 * DPoP/passkey init + data fetch, then `handle.update()` re-renders into
 * the full account view.
 *
 * Push-related state and operations live in `./lib/push/`; this file owns
 * passkey/account flows and the render tree.
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
  createPushManager,
  type PushManager,
  pushSummaryText,
} from "./lib/push/mod.ts";

type AlertKind = "info" | "success" | "warning" | "error";

interface User {
  id: string;
  username: string;
}

interface Credential {
  id: string;
  nickname: string;
  createdAt: number;
  updatedAt: number;
}

interface Account {
  user: User;
  credentials: Credential[];
}

export interface MeProps {
  [key: string]: SerializableValue;
}

const CREDENTIAL_INPUT_ID = "rmx-credential-edit-input";
const PUSH_DEVICE_INPUT_ID = "rmx-push-device-edit-input";

const isClientEnv = typeof globalThis !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined" &&
  typeof (globalThis as { window?: unknown }).window !== "undefined";

const formatDate = (value: number): string => {
  try {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
  } catch {
    return "-";
  }
};

const extractErrorMessage = async (response: Response): Promise<string> => {
  try {
    const data = await response.clone().json();
    if (
      data && typeof data === "object" &&
      typeof (data as { message?: unknown }).message === "string"
    ) {
      const m = (data as { message: string }).message.trim();
      if (m) return m;
    }
  } catch { /* ignore */ }
  try {
    const text = await response.text();
    if (text.trim()) return text.trim();
  } catch { /* ignore */ }
  return `リクエストがステータス${response.status}で失敗しました`;
};

export const Me = clientEntry(
  "/me.js#Me",
  function Me(handle: Handle<MeProps>) {
    // ---------- State (lives across re-renders via setup-scope closure) ----
    let phase: "loading" | "ready" | "error" = "loading";
    let errorMessage: string | null = null;

    let account: Account | null = null;

    type StatusState = { message: string; kind: AlertKind } | null;
    let status: StatusState = null;
    let statusTimeout: ReturnType<typeof setTimeout> | null = null;

    let credentialEdit: { id: string; original: string } | null = null;
    let pushDeviceEdit: { id: string; original: string } | null = null;

    const busy = {
      logout: false,
      deleteAccount: false,
      addPasskey: false,
    };

    let fetchDpop: typeof fetch | null = null;
    let passkeyClient: ReturnType<typeof createClient> | null = null;
    let pushManager: PushManager | null = null;

    // ---------- Helpers ----------
    const setStatus = (
      message: string,
      kind: AlertKind = "info",
      autoHide = false,
    ) => {
      status = { message, kind };
      if (statusTimeout !== null) {
        clearTimeout(statusTimeout);
        statusTimeout = null;
      }
      if (autoHide) {
        statusTimeout = setTimeout(() => {
          status = null;
          statusTimeout = null;
          handle.update();
        }, 4000);
      }
      handle.update();
    };

    const dismissStatus = () => {
      if (statusTimeout !== null) {
        clearTimeout(statusTimeout);
        statusTimeout = null;
      }
      status = null;
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

    const fetchAccount = async (): Promise<Account> => {
      if (!fetchDpop) throw new Error("DPoP not initialized");
      const r = await fetchDpop("/credentials");
      if (r.status === 401) throw new Error("サインインが必要です。");
      if (!r.ok) throw new Error(await extractErrorMessage(r));
      const data = await r.json() as {
        userId?: string;
        credentials?: unknown;
      };
      if (!data?.userId) throw new Error("アカウントが見つかりません。");
      return {
        user: { id: data.userId, username: data.userId },
        credentials: Array.isArray(data.credentials)
          ? data.credentials as Credential[]
          : [],
      };
    };

    const reloadAccount = async () => {
      try {
        account = await fetchAccount();
      } catch (e) {
        setStatus(
          e instanceof Error && e.message
            ? e.message
            : "アカウントを更新できません。",
          "error",
        );
      }
      handle.update();
    };

    const renameCredential = async (id: string, raw: string) => {
      if (!fetchDpop) return;
      const nickname = raw.trim();
      if (!nickname) {
        setStatus("パスキーの名前を入力してください。", "error");
        return;
      }
      try {
        const r = await fetchDpop(
          `/credentials/${encodeURIComponent(id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nickname }),
          },
        );
        if (!r.ok) throw new Error(await extractErrorMessage(r));
        const data = await r.json() as { credential?: { nickname?: string } };
        const finalName = data?.credential?.nickname?.trim() || nickname;
        setStatus(
          `パスキーの名前を「${finalName}」に更新しました。`,
          "success",
          true,
        );
        credentialEdit = null;
        await reloadAccount();
      } catch (e) {
        setStatus(
          e instanceof Error && e.message
            ? `名前の更新に失敗しました: ${e.message}`
            : "名前の更新に失敗しました。",
          "error",
        );
      }
      handle.update();
    };

    const deleteCredential = async (id: string) => {
      if (!fetchDpop) return;
      if (!confirm("このパスキーを削除しますか？この操作は取り消せません。")) {
        return;
      }
      try {
        setStatus("パスキーを削除しています…");
        const r = await fetchDpop(
          `/credentials/${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        if (!r.ok) throw new Error(await extractErrorMessage(r));
        setStatus("パスキーを削除しました。", "success", true);
        await reloadAccount();
      } catch (e) {
        setStatus(
          e instanceof Error && e.message
            ? `パスキーの削除に失敗しました: ${e.message}`
            : "パスキーの削除に失敗しました。",
          "error",
        );
      }
    };

    const addPasskey = async () => {
      if (busy.addPasskey || !passkeyClient) return;
      busy.addPasskey = true;
      handle.update();
      try {
        setStatus("セキュリティキーの操作を待機しています…");
        const result = await passkeyClient.register();
        const nickname = (result as { credential?: { nickname?: string } })
          ?.credential?.nickname?.trim();
        setStatus(
          nickname
            ? `パスキー「${nickname}」を追加しました。`
            : "パスキーを追加しました。",
          "success",
        );
        await reloadAccount();
      } catch (e) {
        let message = "パスキーの追加に失敗しました。";
        let kind: AlertKind = "error";
        if (e instanceof DOMException) {
          switch (e.name) {
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
              if (e.message?.trim()) {
                message = `パスキーの追加に失敗しました: ${e.message}`;
              }
          }
        } else if (e instanceof Error && e.message.trim()) {
          message = `パスキーの設定に失敗しました: ${e.message}`;
        }
        setStatus(message, kind);
      } finally {
        busy.addPasskey = false;
        handle.update();
      }
    };

    const logout = async () => {
      if (busy.logout || !fetchDpop) return;
      busy.logout = true;
      handle.update();
      try {
        const r = await fetchDpop("/session/logout", { method: "POST" });
        if (!r.ok) throw new Error(await extractErrorMessage(r));
        location.href = "/";
      } catch (e) {
        setStatus(
          e instanceof Error && e.message
            ? `サインアウトに失敗しました: ${e.message}`
            : "サインアウトに失敗しました。",
          "error",
        );
        busy.logout = false;
        handle.update();
      }
    };

    const deleteAccount = async () => {
      if (!account || busy.deleteAccount || !fetchDpop) return;
      if (
        !confirm(
          "アカウントを削除するとすべてのパスキーが消えます。この操作は取り消せません。続行しますか？",
        )
      ) return;
      busy.deleteAccount = true;
      handle.update();
      try {
        const r = await fetchDpop("/account", { method: "DELETE" });
        if (!r.ok) throw new Error(await extractErrorMessage(r));
        location.href = "/";
      } catch (e) {
        setStatus(
          e instanceof Error && e.message
            ? `アカウントの削除に失敗しました: ${e.message}`
            : "アカウントの削除に失敗しました。",
          "error",
        );
        busy.deleteAccount = false;
        handle.update();
      }
    };

    const handlePushSubscribe = () => {
      if (!pushManager) return;
      if (!account) {
        setStatus("通知を設定する前にサインインしてください。", "error");
        return;
      }
      void pushManager.subscribe();
    };

    const handlePushRename = async (id: string, raw: string) => {
      if (!pushManager) return;
      const ok = await pushManager.rename(id, raw);
      if (ok) {
        pushDeviceEdit = null;
        handle.update();
      }
    };

    const initialize = async () => {
      try {
        const dp = await initDpop();
        fetchDpop = dp.fetchDpop as unknown as typeof fetch;
        passkeyClient = createClient({
          fetch: fetchDpop as unknown as typeof fetch,
        });
        pushManager = createPushManager({
          fetchDpop,
          isClientEnv,
          setStatus,
          onChange: () => handle.update(),
        });
        pushManager.init();
        const session = await getSession();
        if (!session?.userId) {
          location.href = "/";
          return;
        }
        account = await fetchAccount();
        await pushManager.load(true);
        phase = "ready";
      } catch (e) {
        phase = "error";
        errorMessage = e instanceof Error
          ? e.message
          : "アカウント情報を取得できませんでした。";
      }
      handle.update();
    };

    if (isClientEnv) {
      void initialize();
    }

    // ---------- Render ----------
    return () => {
      const push = pushManager?.state ?? null;
      return (
        <main class="mx-auto w-full max-w-3xl p-6 space-y-10">
          <header class="flex items-center justify-between gap-3">
            <h1 class="text-2xl font-bold">アカウント</h1>
            <button
              type="button"
              disabled={busy.logout}
              class="btn btn-outline btn-sm"
              mix={[on("click", () => {
                void logout();
              })]}
            >
              ログアウト
            </button>
          </header>

          <div
            class="toast toast-top toast-end"
            aria-live="polite"
            aria-atomic="true"
          >
            {status && (
              <div
                role="status"
                class={`alert alert-${status.kind}`}
                mix={[on("click", () => dismissStatus())]}
              >
                <span>{status.message}</span>
              </div>
            )}
          </div>

          {phase === "loading" && (
            <div class="flex justify-center py-12">
              <span
                class="loading loading-spinner loading-lg"
                aria-label="loading"
              >
              </span>
            </div>
          )}

          {phase === "error" && (
            <div role="alert" class="alert alert-error">
              <span>{errorMessage ?? "エラーが発生しました。"}</span>
            </div>
          )}

          {phase === "ready" && account && push && (
            <section class="space-y-10">
              <div class="card bg-base-100">
                <div class="card-body">
                  <h2 class="card-title">プロフィール情報</h2>
                  <label class="form-control w-full max-w-sm">
                    <div class="label">
                      <span class="label-text">ユーザー名</span>
                    </div>
                    <input
                      type="text"
                      name="username"
                      readonly
                      value={account.user.username}
                      class="input input-bordered"
                    />
                  </label>
                </div>
              </div>

              <div class="card bg-base-100">
                <div class="card-body">
                  <header class="flex items-start justify-between gap-3">
                    <div>
                      <h2 class="card-title">パスキー</h2>
                      <p class="text-sm text-base-content/60">
                        新しいデバイスを登録したり、不要な鍵を削除できます。
                      </p>
                    </div>
                  </header>
                  <ul class="mt-3 space-y-3">
                    {account.credentials.length === 0 && (
                      <li class="text-base-content/60 italic">
                        まだパスキーが登録されていません。
                      </li>
                    )}
                    {account.credentials.map((c) => (
                      <li class="rounded-box border border-base-300 bg-base-200/40 p-4 space-y-2">
                        <div class="flex items-baseline gap-3">
                          <strong class="text-base">
                            {c.nickname?.trim() || "名前のないデバイス"}
                          </strong>
                        </div>
                        <dl class="grid gap-2 text-sm sm:grid-cols-2">
                          <div class="flex gap-2">
                            <dt class="text-base-content/60">登録日</dt>
                            <dd class="font-medium">
                              {formatDate(c.createdAt)}
                            </dd>
                          </div>
                          <div class="flex gap-2">
                            <dt class="text-base-content/60">最終使用日</dt>
                            <dd class="font-medium">
                              {c.updatedAt ? formatDate(c.updatedAt) : "-"}
                            </dd>
                          </div>
                        </dl>
                        <div class="flex gap-2">
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs"
                            mix={[on("click", () => {
                              credentialEdit = {
                                id: c.id,
                                original: c.nickname?.trim() ?? "",
                              };
                              handle.update();
                            })]}
                          >
                            変更
                          </button>
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs text-error"
                            mix={[on("click", () => {
                              void deleteCredential(c.id);
                            })]}
                          >
                            削除
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={busy.addPasskey}
                    class="btn btn-primary btn-sm"
                    mix={[on("click", () => {
                      void addPasskey();
                    })]}
                  >
                    別の鍵を追加
                  </button>
                </div>
              </div>

              <div class="card bg-base-100">
                <div class="card-body">
                  <header class="flex items-start justify-between gap-3">
                    <div>
                      <h2 class="card-title">通知</h2>
                      <p class="text-sm text-base-content/60">
                        {pushSummaryText({
                          supported: push.supported,
                          permission: push.permission,
                          hasSubscription: push.currentId != null,
                        })}
                      </p>
                    </div>
                  </header>
                  <ul class="mt-3 space-y-3">
                    {!push.supported && (
                      <li class="text-base-content/60 italic">
                        このブラウザーは Web Push に対応していません。
                      </li>
                    )}
                    {push.supported && push.subscriptions.length === 0 && (
                      <li class="text-base-content/60 italic">
                        まだ通知を受け取るデバイスが登録されていません。
                      </li>
                    )}
                    {push.subscriptions.map((s) => (
                      <li class="rounded-box border border-base-300 bg-base-200/40 p-4 space-y-2">
                        <div class="flex items-baseline gap-3">
                          <strong class="text-base">
                            {s.metadata?.deviceName?.trim() ||
                              "登録済みデバイス"}
                          </strong>
                          {push.currentId === s.id && (
                            <span class="badge badge-success badge-sm">
                              このデバイス
                            </span>
                          )}
                        </div>
                        <dl class="grid gap-2 text-sm sm:grid-cols-2 mt-1">
                          <div class="flex gap-2">
                            <dt class="text-base-content/60">更新日</dt>
                            <dd class="font-medium">
                              {formatDate(s.updatedAt)}
                            </dd>
                          </div>
                          <div class="flex gap-2">
                            <dt class="text-base-content/60">最終通知</dt>
                            <dd class="font-medium">
                              {s.metadata?.lastSuccessfulSendAt
                                ? formatDate(s.metadata.lastSuccessfulSendAt)
                                : "-"}
                            </dd>
                          </div>
                          {s.metadata?.lastError && (
                            <div class="flex gap-2 sm:col-span-2">
                              <dt class="text-base-content/60">状態</dt>
                              <dd class="font-medium">
                                {s.metadata.lastError}
                                {s.metadata.lastErrorAt
                                  ? ` (${formatDate(s.metadata.lastErrorAt)})`
                                  : ""}
                              </dd>
                            </div>
                          )}
                        </dl>
                        <div class="flex gap-2 mt-2">
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs"
                            mix={[on("click", () => {
                              pushDeviceEdit = {
                                id: s.id,
                                original: s.metadata?.deviceName?.trim() ?? "",
                              };
                              handle.update();
                            })]}
                          >
                            名前を変更
                          </button>
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs"
                            mix={[on("click", () => {
                              void pushManager?.test(s.id);
                            })]}
                          >
                            テスト通知
                          </button>
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs text-error"
                            mix={[on("click", () => {
                              void pushManager?.remove(s.id);
                            })]}
                          >
                            解除
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={!push.supported ||
                      push.permission === "denied" ||
                      push.loading}
                    class="btn btn-primary btn-sm"
                    mix={[on("click", () => handlePushSubscribe())]}
                  >
                    {push.currentId && push.permission === "granted"
                      ? "このデバイスを更新"
                      : "このデバイスへの通知を登録"}
                  </button>
                </div>
              </div>

              <div class="card bg-base-100">
                <div class="card-body">
                  <button
                    type="button"
                    disabled={busy.deleteAccount}
                    class="btn btn-error btn-block"
                    mix={[on("click", () => {
                      void deleteAccount();
                    })]}
                  >
                    アカウントを削除
                  </button>
                </div>
              </div>
            </section>
          )}

          {credentialEdit && (
            <div class="modal modal-open" role="dialog" aria-modal="true">
              <div class="modal-box space-y-4">
                <h2 class="text-lg font-semibold">パスキーの名前を変更</h2>
                <label class="form-control w-full">
                  <div class="label">
                    <span class="label-text">表示名</span>
                  </div>
                  <input
                    id={CREDENTIAL_INPUT_ID}
                    type="text"
                    placeholder="名前のないデバイス"
                    autocomplete="off"
                    required
                    value={credentialEdit.original}
                    class="input input-bordered"
                  />
                </label>
                <div class="modal-action">
                  <button
                    type="button"
                    class="btn btn-ghost"
                    mix={[on("click", () => {
                      credentialEdit = null;
                      handle.update();
                    })]}
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary"
                    mix={[on("click", () => {
                      if (!credentialEdit) {
                        return;
                      }
                      const input = document.getElementById(
                        CREDENTIAL_INPUT_ID,
                      ) as HTMLInputElement | null;
                      if (input) {
                        void renameCredential(credentialEdit.id, input.value);
                      }
                    })]}
                  >
                    保存
                  </button>
                </div>
              </div>
              <div
                class="modal-backdrop"
                mix={[on("click", () => {
                  credentialEdit = null;
                  handle.update();
                })]}
              />
            </div>
          )}

          {pushDeviceEdit && (
            <div class="modal modal-open" role="dialog" aria-modal="true">
              <div class="modal-box space-y-4">
                <h2 class="text-lg font-semibold">通知デバイスの名前を変更</h2>
                <label class="form-control w-full">
                  <div class="label">
                    <span class="label-text">表示名</span>
                  </div>
                  <input
                    id={PUSH_DEVICE_INPUT_ID}
                    type="text"
                    placeholder="登録済みデバイス"
                    autocomplete="off"
                    required
                    value={pushDeviceEdit.original}
                    class="input input-bordered"
                  />
                </label>
                <div class="modal-action">
                  <button
                    type="button"
                    class="btn btn-ghost"
                    mix={[on("click", () => {
                      pushDeviceEdit = null;
                      handle.update();
                    })]}
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary"
                    mix={[on("click", () => {
                      if (!pushDeviceEdit) {
                        return;
                      }
                      const input = document.getElementById(
                        PUSH_DEVICE_INPUT_ID,
                      ) as HTMLInputElement | null;
                      if (input) {
                        void handlePushRename(pushDeviceEdit.id, input.value);
                      }
                    })]}
                  >
                    保存
                  </button>
                </div>
              </div>
              <div
                class="modal-backdrop"
                mix={[on("click", () => {
                  pushDeviceEdit = null;
                  handle.update();
                })]}
              />
            </div>
          )}
        </main>
      );
    };
  },
);
