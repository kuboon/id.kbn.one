import type { PushStatus } from "@kuboon/browser-how-to/push";

import type { PushSubscriptionMetadata } from "./types.ts";

const isClientEnv = typeof globalThis !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined" &&
  typeof (globalThis as { window?: unknown }).window !== "undefined";

export const detectDeviceName = (): string => {
  if (!isClientEnv) return "このデバイス";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("iphone")) return "iPhone";
  if (ua.includes("ipad")) return "iPad";
  if (ua.includes("android")) {
    return ua.includes("mobile")
      ? "Android スマートフォン"
      : "Android デバイス";
  }
  if (ua.includes("windows")) return "Windows PC";
  if (ua.includes("mac os")) return "Mac";
  if (ua.includes("linux")) return "Linux";
  return "このデバイス";
};

export const collectPushMetadata = (): PushSubscriptionMetadata => {
  if (!isClientEnv) return {};
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch { /* ignore */ }
  return {
    deviceName: detectDeviceName(),
    userAgent: navigator.userAgent,
    language: typeof navigator.language === "string"
      ? navigator.language
      : undefined,
    timezone,
  };
};

export const pushSummaryText = (s: {
  support: PushStatus["support"];
  permission: NotificationPermission;
  hasSubscription: boolean;
}): string => {
  switch (s.support) {
    case "unsupported":
      return "このブラウザーは Web Push に対応していません。";
    case "needs-install":
      // iOS delivers Web Push only to a home-screen-installed PWA.
      return "iPhone / iPad で通知を受け取るには、先にこのサイトをホーム画面に追加してください。下のボタンから手順を案内します。";
    case "in-app-blocked":
      return "アプリ内ブラウザーでは通知を登録できません。下のボタンから標準ブラウザーで開く手順を案内します。";
    case "denied":
      return "通知がブロックされています。下のボタンから解除手順を案内します。";
    case "ready":
      if (s.permission === "granted") {
        return s.hasSubscription
          ? "通知が許可されています。テスト通知を送信して動作を確認できます。"
          : "通知が許可されています。このデバイスを登録してください。";
      }
      return "通知を許可するとサインイン時にスマートフォンへプッシュ通知を送れます。";
  }
};
