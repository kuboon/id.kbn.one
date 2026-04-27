/**
 * GET /me — account dashboard. Renders a static daisyui shell that
 * `client/me.ts` populates with credentials and push subscriptions.
 */

import type { RequestHandler } from "@remix-run/fetch-router";
import { renderPage } from "../utils/render.tsx";

export const meAction: RequestHandler = (context) =>
  renderPage(
    context,
    <main class="mx-auto w-full max-w-3xl p-6 space-y-6">
      <header class="flex items-center justify-between gap-3">
        <h1 class="text-2xl font-bold">アカウント</h1>
        <button type="button" id="logout" class="btn btn-outline btn-sm">
          ログアウト
        </button>
      </header>

      <div
        class="toast toast-top toast-end"
        aria-live="polite"
        aria-atomic="true"
      >
        <div
          class="alert alert-info"
          id="status"
          data-status="info"
          data-visible="false"
          role="status"
          hidden
        >
          <span>準備が整いました。</span>
        </div>
      </div>

      <section id="account-view" class="space-y-4" hidden>
        <div class="card card-border bg-base-100">
          <div class="card-body">
            <h2 class="card-title">プロフィール情報</h2>
            <label class="form-control w-full max-w-sm">
              <div class="label">
                <span class="label-text">ユーザー名</span>
              </div>
              <input
                id="account-username"
                type="text"
                name="username"
                readonly
                class="input input-bordered"
              />
            </label>
          </div>
        </div>

        <div class="card card-border bg-base-100">
          <div class="card-body">
            <header class="flex items-start justify-between gap-3">
              <div>
                <h2 class="card-title">パスキー</h2>
                <p class="text-sm text-base-content/60">
                  新しいデバイスを登録したり、不要な鍵を削除できます。
                </p>
              </div>
              <button
                type="button"
                id="add-passkey"
                class="btn btn-primary btn-sm"
              >
                別の鍵を追加
              </button>
            </header>
            <ul id="credential-list" class="mt-3 space-y-3">
              <li class="text-base-content/60 italic">
                パスキーを読み込んでいます…
              </li>
            </ul>
            <template id="credential-item-template">
              <li class="rounded-box border border-base-300 bg-base-200/40 p-4 space-y-2">
                <div class="flex items-baseline gap-3">
                  <strong data-role="credential-title" class="text-base">
                  </strong>
                </div>
                <dl class="grid gap-2 text-sm sm:grid-cols-2">
                  <div class="flex gap-2">
                    <dt class="text-base-content/60">登録日</dt>
                    <dd data-role="credential-created" class="font-medium"></dd>
                  </div>
                  <div class="flex gap-2">
                    <dt class="text-base-content/60">最終使用日</dt>
                    <dd data-role="credential-last-used" class="font-medium">
                    </dd>
                  </div>
                </dl>
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    data-action="edit-credential"
                  >
                    変更
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs text-error"
                    data-action="delete-credential"
                  >
                    削除
                  </button>
                </div>
              </li>
            </template>
          </div>
        </div>

        <div class="card card-border bg-base-100" id="push-card">
          <div class="card-body">
            <header class="flex items-start justify-between gap-3">
              <div>
                <h2 class="card-title">通知</h2>
                <p class="text-sm text-base-content/60" id="push-summary">
                  スマートフォンやブラウザーに web push 通知を送信できます。
                </p>
              </div>
              <button
                type="button"
                id="enable-push"
                class="btn btn-primary btn-sm"
              >
                通知を有効化
              </button>
            </header>
            <ul id="push-subscription-list" class="mt-3 space-y-3">
              <li class="text-base-content/60 italic">
                通知設定を読み込んでいます…
              </li>
            </ul>
          </div>
        </div>

        <div class="card card-border bg-base-100">
          <div class="card-body">
            <button
              type="button"
              id="delete-account"
              class="btn btn-error btn-block"
            >
              アカウントを削除
            </button>
          </div>
        </div>
      </section>

      <dialog id="credential-dialog" class="modal">
        <form id="credential-form" method="dialog" class="modal-box space-y-4">
          <h2 class="text-lg font-semibold">パスキーの名前を変更</h2>
          <label class="form-control w-full">
            <div class="label">
              <span class="label-text">表示名</span>
            </div>
            <input
              id="credential-nickname"
              name="nickname"
              type="text"
              placeholder="名前のないデバイス"
              autocomplete="off"
              required
              class="input input-bordered"
            />
          </label>
          <div class="modal-action">
            <button
              type="button"
              id="cancel-credential-dialog"
              class="btn btn-ghost"
            >
              キャンセル
            </button>
            <button
              type="submit"
              id="submit-credential-dialog"
              class="btn btn-primary"
            >
              保存
            </button>
          </div>
        </form>
        <form method="dialog" class="modal-backdrop">
          <button type="button">close</button>
        </form>
      </dialog>

      <dialog id="push-device-dialog" class="modal">
        <form id="push-device-form" method="dialog" class="modal-box space-y-4">
          <h2 class="text-lg font-semibold">通知デバイスの名前を変更</h2>
          <label class="form-control w-full">
            <div class="label">
              <span class="label-text">表示名</span>
            </div>
            <input
              id="push-device-name"
              name="deviceName"
              type="text"
              placeholder="登録済みデバイス"
              autocomplete="off"
              required
              class="input input-bordered"
            />
          </label>
          <div class="modal-action">
            <button
              type="button"
              id="cancel-push-device-dialog"
              class="btn btn-ghost"
            >
              キャンセル
            </button>
            <button
              type="submit"
              id="submit-push-device-dialog"
              class="btn btn-primary"
            >
              保存
            </button>
          </div>
        </form>
        <form method="dialog" class="modal-backdrop">
          <button type="button">close</button>
        </form>
      </dialog>
    </main>,
    { scripts: ["/me.js"] },
  );
