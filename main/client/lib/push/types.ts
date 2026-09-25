import type { PushStatus } from "@kuboon/browser-how-to/push";

export interface PushSubscriptionMetadata {
  deviceName?: string;
  userAgent?: string;
  language?: string;
  timezone?: string;
  lastSuccessfulSendAt?: number;
  lastError?: string;
  lastErrorAt?: number;
}

export interface PushSubscriptionItem {
  id: string;
  endpoint: string;
  updatedAt: number;
  metadata?: PushSubscriptionMetadata;
}

export type PushAlertKind = "info" | "success" | "warning" | "error";

export interface PushManagerState {
  supported: boolean;
  /**
   * Why push can or cannot be enabled here, from `detectPushStatus()`. Note
   * that `"needs-install"` (iOS outside a home-screen PWA) still reports the
   * Push APIs as present, so this — not `supported` — decides whether
   * subscribing can work.
   */
  support: PushStatus["support"];
  permission: NotificationPermission;
  subscriptions: PushSubscriptionItem[];
  currentId: string | null;
  vapidKey: string | null;
  registration: ServiceWorkerRegistration | null;
  loading: boolean;
}

export interface PushManagerDeps {
  fetchDpop: typeof fetch;
  isClientEnv: boolean;
  setStatus: (
    message: string,
    kind?: PushAlertKind,
    autoHide?: boolean,
  ) => void;
  onChange: () => void;
}
