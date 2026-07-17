/**
 * Danger zone island — irreversible account deletion (removes every passkey
 * and logs the user out).
 */

import { clientEntry, type Handle, on } from "@remix-run/ui";

import { extractErrorMessage, getFetchDpop } from "./util.ts";
import { type InlineStatus, statusAlert } from "./status.tsx";

export const DangerZone = clientEntry(
  "/me/mod.js#DangerZone",
  function DangerZone(handle: Handle) {
    let busy = false;
    let status: InlineStatus | null = null;

    const deleteAccount = async () => {
      if (busy) return;
      if (
        !confirm(
          "アカウントを削除するとすべてのパスキーが消えます。この操作は取り消せません。続行しますか？",
        )
      ) return;
      busy = true;
      handle.update();
      try {
        const fetchDpop = await getFetchDpop();
        const r = await fetchDpop("/account", { method: "DELETE" });
        if (!r.ok) throw new Error(await extractErrorMessage(r));
        location.href = "/";
      } catch (e) {
        status = {
          message: e instanceof Error && e.message
            ? `アカウントの削除に失敗しました: ${e.message}`
            : "アカウントの削除に失敗しました。",
          kind: "error",
        };
        busy = false;
        handle.update();
      }
    };

    return () => (
      <div class="card bg-base-100">
        <div class="card-body">
          {statusAlert(status, () => {
            status = null;
            handle.update();
          })}
          <button
            type="button"
            disabled={busy}
            class="btn btn-error btn-block"
            mix={[on("click", () => {
              void deleteAccount();
            })]}
          >
            アカウントを削除
          </button>
        </div>
      </div>
    );
  },
);
