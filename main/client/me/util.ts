/**
 * Shared helpers for the `/me` island components.
 *
 * All `/me` islands are bundled into a single module (`me/mod.js`), so this
 * module is a singleton across them: `getFetchDpop()` memoizes the DPoP
 * bootstrap once and every island reuses the same signed-fetch instance.
 */

import { init as initDpop } from "@kuboon/dpop";

export type AlertKind = "info" | "success" | "warning" | "error";

export const isClientEnv = typeof globalThis !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined" &&
  typeof (globalThis as { window?: unknown }).window !== "undefined";

let fetchDpopPromise: Promise<typeof fetch> | null = null;

/** Lazily bootstrap DPoP and return the signed-fetch, shared across islands. */
export const getFetchDpop = (): Promise<typeof fetch> => {
  if (!fetchDpopPromise) {
    fetchDpopPromise = initDpop().then((dp) =>
      dp.fetchDpop as unknown as typeof fetch
    );
  }
  return fetchDpopPromise;
};

export const formatDate = (value: number): string => {
  try {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
  } catch {
    return "-";
  }
};

export const extractErrorMessage = async (
  response: Response,
): Promise<string> => {
  try {
    const data = await response.clone().json();
    if (
      data && typeof data === "object" &&
      typeof (data as { message?: unknown }).message === "string"
    ) {
      const m = (data as { message: string }).message.trim();
      if (m) return m;
    }
  } catch { /* ignore */ }
  try {
    const text = await response.text();
    if (text.trim()) return text.trim();
  } catch { /* ignore */ }
  return `リクエストがステータス${response.status}で失敗しました`;
};
