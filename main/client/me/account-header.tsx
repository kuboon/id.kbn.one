/**
 * Account header island — page title, logout, and the session gate.
 *
 * On mount it checks `/session`; if no user is bound it redirects to `/`, so
 * this single always-present island owns the "must be signed in" guard for
 * the whole page. The other islands just surface a 401 inline if reached.
 */

import { clientEntry, type Handle, on } from "@remix-run/ui";

import { extractErrorMessage, getFetchDpop, isClientEnv } from "./util.ts";
import { type InlineStatus, statusAlert } from "./status.tsx";

export const AccountHeader = clientEntry(
  "/me/mod.js#AccountHeader",
  function AccountHeader(handle: Handle) {
    let busy = false;
    let status: InlineStatus | null = null;

    const setStatus = (message: string) => {
      status = { message, kind: "error" };
      handle.update();
    };

    const initialize = async () => {
      try {
        const fetchDpop = await getFetchDpop();
        const r = await fetchDpop("/session");
        const data = r.ok ? await r.json() as { userId?: string } : null;
        if (!data?.userId) location.href = "/";
      } catch {
        // Session probe failed; the feature islands will surface their own
        // errors. Don't redirect on a transient network blip.
      }
    };

    const logout = async () => {
      if (busy) return;
      busy = true;
      handle.update();
      try {
        const fetchDpop = await getFetchDpop();
        const r = await fetchDpop("/session/logout", { method: "POST" });
        if (!r.ok) throw new Error(await extractErrorMessage(r));
        location.href = "/";
      } catch (e) {
        setStatus(
          e instanceof Error && e.message
            ? `サインアウトに失敗しました: ${e.message}`
            : "サインアウトに失敗しました。",
        );
        busy = false;
        handle.update();
      }
    };

    if (isClientEnv) void initialize();

    return () => (
      <header class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <h1 class="text-2xl font-bold">アカウント</h1>
          <button
            type="button"
            disabled={busy}
            class="btn btn-outline btn-sm"
            mix={[on("click", () => {
              void logout();
            })]}
          >
            ログアウト
          </button>
        </div>
        {statusAlert(status, () => {
          status = null;
          handle.update();
        })}
      </header>
    );
  },
);
