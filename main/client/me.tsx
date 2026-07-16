/**
 * /me page — Remix v3 clientEntry orchestrator.
 *
 * This component owns the cross-cutting concerns of the account dashboard:
 * DPoP/passkey/push initialization, the account fetch, and the status toast.
 * Each feature is a separate presentation/edit component under `./me/`:
 *   - {@link ProfileCard}        — display nickname + userId
 *   - {@link PasskeysCard}       — list / add / rename / delete passkeys
 *   - {@link NotificationsCard}  — Web Push subscriptions
 *   - {@link DangerZone}         — account deletion
 *
 * The component is rendered server-side in a `phase = "loading"` state so the
 * user gets an immediate shell; the feature cards only render on the client
 * once `initialize()` has fetched the account, so passing plain callbacks as
 * props to them is safe (they never cross the serialization boundary).
 */

import {
  clientEntry,
  type Handle,
  on,
  type SerializableValue,
} from "@remix-run/ui";
import { createClient } from "@kuboon/passkeys";
import { init as initDpop } from "@kuboon/dpop";
import { createPushManager, type PushManager } from "./lib/push/mod.ts";
import { NICKNAME_MAX_LENGTH } from "./lib/profile.ts";

import type { Account, AlertKind } from "./me/types.ts";
import { extractErrorMessage } from "./me/util.ts";
import { ProfileCard } from "./me/profile-card.tsx";
import { PasskeysCard } from "./me/passkeys-card.tsx";
import { NotificationsCard } from "./me/notifications-card.tsx";
import { DangerZone } from "./me/danger-zone.tsx";

export interface MeProps {
  [key: string]: SerializableValue;
}

const isClientEnv = typeof globalThis !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined" &&
  typeof (globalThis as { window?: unknown }).window !== "undefined";

export const Me = clientEntry(
  "/me.js#Me",
  function Me(handle: Handle<MeProps>) {
    // ---------- State (lives across re-renders via setup-scope closure) ----
    let phase: "loading" | "ready" | "error" = "loading";
    let errorMessage: string | null = null;

    let account: Account | null = null;

    type StatusState = { message: string; kind: AlertKind } | null;
    let status: StatusState = null;
    let statusTimeout: ReturnType<typeof setTimeout> | null = null;

    const busy = { logout: false };

    let fetchDpop: typeof fetch | null = null;
    let passkeyClient: ReturnType<typeof createClient> | null = null;
    let pushManager: PushManager | null = null;

    // ---------- Helpers ----------
    const setStatus = (
      message: string,
      kind: AlertKind = "info",
      autoHide = false,
    ) => {
      status = { message, kind };
      if (statusTimeout !== null) {
        clearTimeout(statusTimeout);
        statusTimeout = null;
      }
      if (autoHide) {
        statusTimeout = setTimeout(() => {
          status = null;
          statusTimeout = null;
          handle.update();
        }, 4000);
      }
      handle.update();
    };

    const dismissStatus = () => {
      if (statusTimeout !== null) {
        clearTimeout(statusTimeout);
        statusTimeout = null;
      }
      status = null;
      handle.update();
    };

    const getSession = async (): Promise<{ userId?: string } | null> => {
      if (!fetchDpop) return null;
      try {
        const r = await fetchDpop("/session");
        return r.ok ? await r.json() as { userId?: string } : null;
      } catch {
        return null;
      }
    };

    const fetchAccount = async (): Promise<Account> => {
      if (!fetchDpop) throw new Error("DPoP not initialized");
      const r = await fetchDpop("/credentials");
      if (r.status === 401) throw new Error("サインインが必要です。");
      if (!r.ok) throw new Error(await extractErrorMessage(r));
      const data = await r.json() as {
        userId?: string;
        nickname?: unknown;
        credentials?: unknown;
      };
      if (!data?.userId) throw new Error("アカウントが見つかりません。");
      return {
        user: {
          id: data.userId,
          nickname: typeof data.nickname === "string" ? data.nickname : "",
        },
        credentials: Array.isArray(data.credentials)
          ? data.credentials as Account["credentials"]
          : [],
      };
    };

    const reloadAccount = async () => {
      try {
        account = await fetchAccount();
      } catch (e) {
        setStatus(
          e instanceof Error && e.message
            ? e.message
            : "アカウントを更新できません。",
          "error",
        );
      }
      handle.update();
    };

    const onNicknameUpdated = (nickname: string) => {
      if (account) account.user.nickname = nickname;
      handle.update();
    };

    const logout = async () => {
      if (busy.logout || !fetchDpop) return;
      busy.logout = true;
      handle.update();
      try {
        const r = await fetchDpop("/session/logout", { method: "POST" });
        if (!r.ok) throw new Error(await extractErrorMessage(r));
        location.href = "/";
      } catch (e) {
        setStatus(
          e instanceof Error && e.message
            ? `サインアウトに失敗しました: ${e.message}`
            : "サインアウトに失敗しました。",
          "error",
        );
        busy.logout = false;
        handle.update();
      }
    };

    const initialize = async () => {
      try {
        const dp = await initDpop();
        fetchDpop = dp.fetchDpop as unknown as typeof fetch;
        passkeyClient = createClient({
          fetch: fetchDpop as unknown as typeof fetch,
        });
        pushManager = createPushManager({
          fetchDpop,
          isClientEnv,
          setStatus,
          onChange: () => handle.update(),
        });
        pushManager.init();
        const session = await getSession();
        if (!session?.userId) {
          location.href = "/";
          return;
        }
        account = await fetchAccount();
        await pushManager.load(true);
        phase = "ready";
      } catch (e) {
        phase = "error";
        errorMessage = e instanceof Error
          ? e.message
          : "アカウント情報を取得できませんでした。";
      }
      handle.update();
    };

    if (isClientEnv) {
      void initialize();
    }

    // ---------- Render ----------
    return () => (
      <main class="mx-auto w-full max-w-3xl p-6 space-y-10">
        <header class="flex items-center justify-between gap-3">
          <h1 class="text-2xl font-bold">アカウント</h1>
          <button
            type="button"
            disabled={busy.logout}
            class="btn btn-outline btn-sm"
            mix={[on("click", () => {
              void logout();
            })]}
          >
            ログアウト
          </button>
        </header>

        <div
          class="toast toast-top toast-end"
          aria-live="polite"
          aria-atomic="true"
        >
          {status && (
            <div
              role="status"
              class={`alert alert-${status.kind}`}
              mix={[on("click", () => dismissStatus())]}
            >
              <span>{status.message}</span>
            </div>
          )}
        </div>

        {phase === "loading" && (
          <div class="flex justify-center py-12">
            <span
              class="loading loading-spinner loading-lg"
              aria-label="loading"
            >
            </span>
          </div>
        )}

        {phase === "error" && (
          <div role="alert" class="alert alert-error">
            <span>{errorMessage ?? "エラーが発生しました。"}</span>
          </div>
        )}

        {phase === "ready" && account && fetchDpop && passkeyClient &&
          pushManager && (
          <section class="space-y-10">
            <ProfileCard
              nickname={account.user.nickname}
              userId={account.user.id}
              maxLength={NICKNAME_MAX_LENGTH}
              fetchDpop={fetchDpop}
              setStatus={setStatus}
              onUpdated={onNicknameUpdated}
            />
            <PasskeysCard
              credentials={account.credentials}
              fetchDpop={fetchDpop}
              passkeyClient={passkeyClient}
              setStatus={setStatus}
              onChanged={reloadAccount}
            />
            <NotificationsCard pushManager={pushManager} />
            <DangerZone fetchDpop={fetchDpop} setStatus={setStatus} />
          </section>
        )}
      </main>
    );
  },
);
