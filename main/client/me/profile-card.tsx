/**
 * Profile card — shows the immutable userId and the editable display nickname.
 *
 * The nickname length cap is passed in as the `maxLength` prop (the caller
 * owns the shared `NICKNAME_MAX_LENGTH` constant) so this card stays a pure
 * presentation/edit unit.
 */

import { type Handle, on } from "@remix-run/ui";

import type { SetStatus } from "./types.ts";
import { extractErrorMessage } from "./util.ts";

const PROFILE_INPUT_ID = "rmx-profile-edit-input";

export interface ProfileCardProps {
  nickname: string;
  userId: string;
  maxLength: number;
  fetchDpop: typeof fetch;
  setStatus: SetStatus;
  /** Called with the persisted nickname so the parent can refresh its state. */
  onUpdated: (nickname: string) => void;
}

export function ProfileCard(handle: Handle<ProfileCardProps>) {
  let editing = false;

  const openEditor = () => {
    editing = true;
    handle.update();
  };

  const closeEditor = () => {
    editing = false;
    handle.update();
  };

  const save = async (raw: string) => {
    const { fetchDpop, setStatus, onUpdated } = handle.props;
    const nickname = raw.trim();
    if (!nickname) {
      setStatus("ユーザー名を入力してください。", "error");
      return;
    }
    try {
      const r = await fetchDpop("/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname }),
      });
      if (!r.ok) throw new Error(await extractErrorMessage(r));
      const data = await r.json() as { profile?: { nickname?: string } };
      const finalName = data?.profile?.nickname?.trim() || nickname;
      editing = false;
      onUpdated(finalName);
      setStatus(
        `ユーザー名を「${finalName}」に更新しました。`,
        "success",
        true,
      );
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

  return () => {
    const { nickname, userId, maxLength } = handle.props;
    return (
      <div class="card bg-base-100">
        <div class="card-body">
          <h2 class="card-title">プロフィール情報</h2>
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
                mix={[on("click", () => openEditor())]}
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
                  mix={[on("click", () =>
                    closeEditor())]}
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
              mix={[on("click", () =>
                closeEditor())]}
            />
          </div>
        )}
      </div>
    );
  };
}
