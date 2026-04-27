/**
 * GET /authorize?dpop_jkt=...&redirect_uri=...
 *
 * Validates the query parameters server-side, then renders an HTML shell.
 * `client/authorize.ts` reads the params and drives the IdP probe + bind +
 * redirect flow.
 */

import type { RequestHandler } from "@remix-run/fetch-router";
import { authorizeWhitelist } from "../config.ts";
import { renderPage } from "../utils/render.tsx";

const jktPattern = /^[A-Za-z0-9_-]{43}$/;

const isAllowedRedirectUri = (redirectUri: string): boolean => {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  return authorizeWhitelist.some((x) =>
    url.hostname === x || url.hostname.endsWith("." + x)
  );
};

export const authorizeAction: RequestHandler = (context) => {
  const url = new URL(context.request.url);
  const dpopJkt = url.searchParams.get("dpop_jkt") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  if (!dpopJkt || !jktPattern.test(dpopJkt)) {
    return Response.json({ message: "Invalid dpop_jkt" }, { status: 400 });
  }
  if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
    return Response.json({
      message: "redirect_uri is missing or not allowed",
    }, { status: 400 });
  }

  return renderPage(
    context,
    <main class="mx-auto w-full max-w-md p-6 space-y-6">
      <header class="text-center">
        <h1 class="text-2xl font-bold">kbn.one ID</h1>
      </header>

      <div class="card card-border bg-base-100">
        <div class="card-body gap-3">
          <div role="alert" class="alert alert-info alert-soft">
            <span id="status" data-state="pending">
              セッションを確認しています…
            </span>
          </div>
          <p id="rp-origin" class="text-sm text-base-content/70" hidden></p>

          <div id="signin-actions" class="flex flex-col gap-2" hidden>
            <button type="button" id="signin" class="btn btn-primary btn-block">
              パスキーでサインイン
            </button>
            <button
              type="button"
              id="create-account"
              class="btn btn-outline btn-block"
            >
              アカウントを作成
            </button>
          </div>
        </div>
      </div>
    </main>,
    { scripts: ["/authorize.js"] },
  );
};
