/**
 * Danger zone — irreversible account deletion (removes every passkey and logs
 * the user out).
 */

import { type Handle, on } from "@remix-run/ui";

import type { SetStatus } from "./types.ts";
import { extractErrorMessage } from "./util.ts";

export interface DangerZoneProps {
  fetchDpop: typeof fetch;
  setStatus: SetStatus;
}

export function DangerZone(handle: Handle<DangerZoneProps>) {
  let busy = false;

  const deleteAccount = async () => {
    const { fetchDpop, setStatus } = handle.props;
    if (busy) return;
    if (
      !confirm(
        "アカウントを削除するとすべてのパスキーが消えます。この操作は取り消せません。続行しますか？",
      )
    ) return;
    busy = true;
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
      busy = false;
      handle.update();
    }
  };

  return () => (
    <div class="card bg-base-100">
      <div class="card-body">
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
}
