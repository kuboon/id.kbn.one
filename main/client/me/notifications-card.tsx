/**
 * Notifications card island — manages the user's Web Push subscriptions. Owns
 * its own `PushManager`, wired to re-render this island on change.
 */

import { clientEntry, type Handle, on } from "@remix-run/ui";

import {
  createPushManager,
  type PushManager,
  pushSummaryText,
} from "../lib/push/mod.ts";
import { formatDate, getFetchDpop, isClientEnv } from "./util.ts";
import { type InlineStatus, statusAlert } from "./status.tsx";

const PUSH_DEVICE_INPUT_ID = "rmx-push-device-edit-input";

export const NotificationsCard = clientEntry(
  "/me/mod.js#NotificationsCard",
  function NotificationsCard(handle: Handle) {
    let deviceEdit: { id: string; original: string } | null = null;
    let status: InlineStatus | null = null;
    let pushManager: PushManager | null = null;

    const initialize = async () => {
      const fetchDpop = await getFetchDpop();
      pushManager = createPushManager({
        fetchDpop,
        isClientEnv,
        setStatus: (message, kind = "info") => {
          status = { message, kind };
          handle.update();
        },
        onChange: () => handle.update(),
      });
      pushManager.init();
      await pushManager.load(true);
      handle.update();
    };

    const rename = async (id: string, raw: string) => {
      if (!pushManager) return;
      const ok = await pushManager.rename(id, raw);
      if (ok) {
        deviceEdit = null;
        handle.update();
      }
    };

    if (isClientEnv) void initialize();

    return () => {
      const push = pushManager?.state ?? null;
      return (
        <div class="card bg-base-100">
          <div class="card-body">
            <header class="flex items-start justify-between gap-3">
              <div>
                <h2 class="card-title">通知</h2>
                <p class="text-sm text-base-content/60">
                  {push
                    ? pushSummaryText({
                      supported: push.supported,
                      permission: push.permission,
                      hasSubscription: push.currentId != null,
                    })
                    : "通知の状態を確認しています…"}
                </p>
              </div>
            </header>
            {statusAlert(status, () => {
              status = null;
              handle.update();
            })}

            {push && (
              <>
                <ul class="mt-3 space-y-3">
                  {push.subscriptions.length === 0 && (
                    <li class="text-base-content/60 italic">
                      まだ通知を受け取るデバイスが登録されていません。
                    </li>
                  )}
                  {push.subscriptions.map((s) => (
                    <li class="rounded-box border border-base-300 bg-base-200/40 p-4 space-y-2">
                      <div class="flex items-baseline gap-3">
                        <strong class="text-base">
                          {s.metadata?.deviceName?.trim() || "登録済みデバイス"}
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
                          <dd class="font-medium">{formatDate(s.updatedAt)}</dd>
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
                            deviceEdit = {
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
                {!push.supported && (
                  <p class="text-sm text-base-content/60 italic mt-3">
                    このブラウザーは Web Push に対応していません。
                  </p>
                )}
                <button
                  type="button"
                  disabled={!push.supported || push.permission === "denied" ||
                    push.loading}
                  class="btn btn-primary btn-sm"
                  mix={[on("click", () => {
                    void pushManager?.subscribe();
                  })]}
                >
                  {push.currentId && push.permission === "granted"
                    ? "このデバイスを更新"
                    : "このデバイスへの通知を登録"}
                </button>
              </>
            )}
          </div>

          {deviceEdit && (
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
                    value={deviceEdit.original}
                    class="input input-bordered"
                  />
                </label>
                <div class="modal-action">
                  <button
                    type="button"
                    class="btn btn-ghost"
                    mix={[on("click", () => {
                      deviceEdit = null;
                      handle.update();
                    })]}
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary"
                    mix={[on("click", () => {
                      if (!deviceEdit) {
                        return;
                      }
                      const input = document.getElementById(
                        PUSH_DEVICE_INPUT_ID,
                      ) as HTMLInputElement | null;
                      if (input) {
                        void rename(deviceEdit.id, input.value);
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
                  deviceEdit = null;
                  handle.update();
                })]}
              />
            </div>
          )}
        </div>
      );
    };
  },
);
