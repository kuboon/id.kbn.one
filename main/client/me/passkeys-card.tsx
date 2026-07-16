/**
 * Passkeys card — lists the user's passkeys and lets them add, rename, and
 * delete keys.
 */

import { type Handle, on } from "@remix-run/ui";
import { createClient } from "@kuboon/passkeys";

import type { Credential, SetStatus } from "./types.ts";
import { extractErrorMessage, formatDate } from "./util.ts";

type PasskeyClient = ReturnType<typeof createClient>;

const CREDENTIAL_INPUT_ID = "rmx-credential-edit-input";

export interface PasskeysCardProps {
  credentials: Credential[];
  fetchDpop: typeof fetch;
  passkeyClient: PasskeyClient;
  setStatus: SetStatus;
  /** Reload the account after the passkey set changes. */
  onChanged: () => void | Promise<void>;
}

export function PasskeysCard(handle: Handle<PasskeysCardProps>) {
  let edit: { id: string; original: string } | null = null;
  let busyAdd = false;

  const rename = async (id: string, raw: string) => {
    const { fetchDpop, setStatus, onChanged } = handle.props;
    const nickname = raw.trim();
    if (!nickname) {
      setStatus("パスキーの名前を入力してください。", "error");
      return;
    }
    try {
      const r = await fetchDpop(`/credentials/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname }),
      });
      if (!r.ok) throw new Error(await extractErrorMessage(r));
      const data = await r.json() as { credential?: { nickname?: string } };
      const finalName = data?.credential?.nickname?.trim() || nickname;
      setStatus(
        `パスキーの名前を「${finalName}」に更新しました。`,
        "success",
        true,
      );
      edit = null;
      await onChanged();
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

  const remove = async (id: string) => {
    const { fetchDpop, setStatus, onChanged } = handle.props;
    if (!confirm("このパスキーを削除しますか？この操作は取り消せません。")) {
      return;
    }
    try {
      setStatus("パスキーを削除しています…");
      const r = await fetchDpop(`/credentials/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(await extractErrorMessage(r));
      setStatus("パスキーを削除しました。", "success", true);
      await onChanged();
    } catch (e) {
      setStatus(
        e instanceof Error && e.message
          ? `パスキーの削除に失敗しました: ${e.message}`
          : "パスキーの削除に失敗しました。",
        "error",
      );
    }
  };

  const add = async () => {
    const { passkeyClient, setStatus, onChanged } = handle.props;
    if (busyAdd) return;
    busyAdd = true;
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
      await onChanged();
    } catch (e) {
      let message = "パスキーの追加に失敗しました。";
      let kind: "info" | "error" = "error";
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
      busyAdd = false;
      handle.update();
    }
  };

  return () => {
    const { credentials } = handle.props;
    return (
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
            {credentials.length === 0 && (
              <li class="text-base-content/60 italic">
                まだパスキーが登録されていません。
              </li>
            )}
            {credentials.map((c) => (
              <li class="rounded-box border border-base-300 bg-base-200/40 p-4 space-y-2">
                <div class="flex items-baseline gap-3">
                  <strong class="text-base">
                    {c.nickname?.trim() || "名前のないデバイス"}
                  </strong>
                </div>
                <dl class="grid gap-2 text-sm sm:grid-cols-2">
                  <div class="flex gap-2">
                    <dt class="text-base-content/60">登録日</dt>
                    <dd class="font-medium">{formatDate(c.createdAt)}</dd>
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
                      edit = { id: c.id, original: c.nickname?.trim() ?? "" };
                      handle.update();
                    })]}
                  >
                    変更
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs text-error"
                    mix={[on("click", () => {
                      void remove(c.id);
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
            disabled={busyAdd}
            class="btn btn-primary btn-sm"
            mix={[on("click", () => {
              void add();
            })]}
          >
            別の鍵を追加
          </button>
        </div>

        {edit && (
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
                  value={edit.original}
                  class="input input-bordered"
                />
              </label>
              <div class="modal-action">
                <button
                  type="button"
                  class="btn btn-ghost"
                  mix={[on("click", () => {
                    edit = null;
                    handle.update();
                  })]}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  mix={[on("click", () => {
                    if (!edit) return;
                    const input = document.getElementById(
                      CREDENTIAL_INPUT_ID,
                    ) as HTMLInputElement | null;
                    if (input) void rename(edit.id, input.value);
                  })]}
                >
                  保存
                </button>
              </div>
            </div>
            <div
              class="modal-backdrop"
              mix={[on("click", () => {
                edit = null;
                handle.update();
              })]}
            />
          </div>
        )}
      </div>
    );
  };
}
