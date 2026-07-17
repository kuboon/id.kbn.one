/**
 * Profile card island — shows the immutable userId and the editable display
 * nickname, and edits the nickname via `PATCH /profile`.
 *
 * `maxLength` is a serializable prop passed by the server (which owns the
 * `NICKNAME_MAX_LENGTH` constant), so the browser never needs its own copy.
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";

import { extractErrorMessage, getFetchDpop, isClientEnv } from "./util.ts";
import { type InlineStatus, statusAlert } from "./status.tsx";

const PROFILE_INPUT_ID = "rmx-profile-edit-input";

export interface ProfileCardProps {
  maxLength: number;
  [key: string]: SerializableValue;
}

export const ProfileCard = clientEntry(
  "/me/mod.js#ProfileCard",
  function ProfileCard(handle: Handle<ProfileCardProps>) {
    let phase: "loading" | "ready" | "error" = "loading";
    let userId = "";
    let nickname = "";
    let editing = false;
    let status: InlineStatus | null = null;

    const setStatus = (
      message: string,
      kind: InlineStatus["kind"] = "info",
    ) => {
      status = { message, kind };
      handle.update();
    };

    const initialize = async () => {
      try {
        const fetchDpop = await getFetchDpop();
        const r = await fetchDpop("/credentials");
        if (r.status === 401) throw new Error("サインインが必要です。");
        if (!r.ok) throw new Error(await extractErrorMessage(r));
        const data = await r.json() as { userId?: string; nickname?: unknown };
        if (!data?.userId) throw new Error("アカウントが見つかりません。");
        userId = data.userId;
        nickname = typeof data.nickname === "string" ? data.nickname : "";
        phase = "ready";
      } catch (e) {
        phase = "error";
        status = {
          message: e instanceof Error && e.message
            ? e.message
            : "プロフィールを取得できませんでした。",
          kind: "error",
        };
      }
      handle.update();
    };

    const save = async (raw: string) => {
      const value = raw.trim();
      if (!value) {
        setStatus("ユーザー名を入力してください。", "error");
        return;
      }
      try {
        const fetchDpop = await getFetchDpop();
        const r = await fetchDpop("/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: value }),
        });
        if (!r.ok) throw new Error(await extractErrorMessage(r));
        const data = await r.json() as { profile?: { nickname?: string } };
        nickname = data?.profile?.nickname?.trim() || value;
        editing = false;
        setStatus(`ユーザー名を「${nickname}」に更新しました。`, "success");
      } catch (e) {
        setStatus(
          e instanceof Error && e.message
            ? `ユーザー名の更新に失敗しました: ${e.message}`
            : "ユーザー名の更新に失敗しました。",
          "error",
        );
      }
      handle.update();
    };

    if (isClientEnv) void initialize();

    return () => {
      const maxLength = handle.props.maxLength;
      return (
        <div class="card bg-base-100">
          <div class="card-body">
            <h2 class="card-title">プロフィール情報</h2>
            {statusAlert(status, () => {
              status = null;
              handle.update();
            })}

            {phase === "loading" && (
              <div class="flex justify-center py-6">
                <span
                  class="loading loading-spinner loading-md"
                  aria-label="loading"
                >
                </span>
              </div>
            )}

            {phase === "ready" && (
              <>
                <label class="form-control w-full max-w-sm">
                  <div class="label">
                    <span class="label-text">ユーザー名</span>
                  </div>
                  <div class="flex gap-2">
                    <input
                      type="text"
                      name="nickname"
                      readonly
                      placeholder="未設定"
                      value={nickname}
                      class="input input-bordered flex-1"
                    />
                    <button
                      type="button"
                      class="btn btn-outline"
                      mix={[on("click", () => {
                        editing = true;
                        handle.update();
                      })]}
                    >
                      変更
                    </button>
                  </div>
                </label>
                <label class="form-control w-full max-w-sm">
                  <div class="label">
                    <span class="label-text">ユーザーID</span>
                  </div>
                  <input
                    type="text"
                    name="userId"
                    readonly
                    value={userId}
                    class="input input-bordered font-mono text-sm"
                  />
                </label>
              </>
            )}
          </div>

          {editing && (
            <div class="modal modal-open" role="dialog" aria-modal="true">
              <div class="modal-box space-y-4">
                <h2 class="text-lg font-semibold">ユーザー名を変更</h2>
                <label class="form-control w-full">
                  <div class="label">
                    <span class="label-text">ユーザー名</span>
                  </div>
                  <input
                    id={PROFILE_INPUT_ID}
                    type="text"
                    placeholder="未設定"
                    autocomplete="off"
                    required
                    maxlength={maxLength}
                    value={nickname}
                    class="input input-bordered"
                  />
                </label>
                <div class="modal-action">
                  <button
                    type="button"
                    class="btn btn-ghost"
                    mix={[on("click", () => {
                      editing = false;
                      handle.update();
                    })]}
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary"
                    mix={[on("click", () => {
                      const input = document.getElementById(
                        PROFILE_INPUT_ID,
                      ) as HTMLInputElement | null;
                      if (input) {
                        void save(input.value);
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
                  editing = false;
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
