/**
 * GET / — sign-in landing page (passkey).
 */

import type { RequestHandler } from "@remix-run/fetch-router";
import { renderPage } from "../utils/render.tsx";

export const homeAction: RequestHandler = (context) =>
  renderPage(
    context,
    <main class="mx-auto w-full max-w-md p-6 space-y-6">
      <header class="text-center">
        <h1 class="text-3xl font-bold">kbn.one ID</h1>
      </header>

      <div class="card card-border bg-base-100 shadow-sm">
        <div class="card-body gap-4">
          <form id="guest-form" autocomplete="off" class="flex flex-col gap-3">
            <button type="submit" class="btn btn-primary btn-block">
              パスキーでサインイン
            </button>
            <button
              type="button"
              id="open-create-account"
              class="btn btn-outline btn-block"
            >
              アカウントを作成
            </button>
          </form>

          <div role="alert" class="alert alert-info alert-soft">
            <span id="conditional-status" data-state="pending">
              パスキーの自動入力に対応しているか確認しています…
            </span>
          </div>
        </div>
      </div>

      <script type="module" src="/index.js"></script>
    </main>,
  );
