import { createClient } from "../../hono-middleware/src/client.ts";

const client = createClient();

const statusEl = document.getElementById("status")!;
const accountView = document.getElementById("account-view")!;
const logoutButton = document.getElementById("logout")!;
const deleteAccountButton = document.getElementById(
  "delete-account",
)!;
const profileForm = document.getElementById("profile-form")! as HTMLFormElement;
const accountUsernameInput = document.getElementById(
  "account-username",
)! as HTMLInputElement;
const profileSubmitButton = profileForm.querySelector(
  'button[type="submit"]',
)! as HTMLButtonElement;
const addPasskeyButton = document.getElementById("add-passkey")!;
const credentialsList = document.getElementById(
  "credential-list",
)!;
const credentialTemplate = document.getElementById(
  "credential-item-template",
)! as HTMLTemplateElement;
const passkeyDialog = document.getElementById("passkey-dialog")! as HTMLDialogElement;
const passkeyForm = document.getElementById("passkey-form")! as HTMLFormElement;
const passkeyDialogCancel = document.getElementById(
  "cancel-passkey-dialog",
)!;
const passkeyDialogSubmit = document.getElementById(
  "submit-passkey-dialog",
)! as HTMLButtonElement;
const credentialDialog = document.getElementById(
  "credential-dialog",
)! as HTMLDialogElement;
const credentialForm = document.getElementById("credential-form")! as HTMLFormElement;
const credentialDialogCancel = document.getElementById(
  "cancel-credential-dialog",
)!;
const credentialDialogSubmit = document.getElementById(
  "submit-credential-dialog",
)! as HTMLButtonElement;
const credentialDialogNickname = document.getElementById(
  "credential-nickname",
)! as HTMLInputElement;
const pushDeviceDialog = document.getElementById(
  "push-device-dialog",
)! as HTMLDialogElement;
const pushDeviceForm = document.getElementById(
  "push-device-form",
)! as HTMLFormElement;
const pushDeviceDialogCancel = document.getElementById(
  "cancel-push-device-dialog",
)!;
const pushDeviceDialogSubmit = document.getElementById(
  "submit-push-device-dialog",
)! as HTMLButtonElement;
const pushDeviceDialogName = document.getElementById(
  "push-device-name",
)! as HTMLInputElement;
const pushCard = document.getElementById("push-card")!;
const pushSummary = document.getElementById("push-summary")!;
const enablePushButton = document.getElementById("enable-push")! as HTMLButtonElement;
const pushSubscriptionList = document.getElementById(
  "push-subscription-list",
)!;

type User = {
  id: string;
  username: string;
};

type Credential = {
  id: string;
  nickname?: string;
  createdAt: string;
  lastUsedAt?: string;
};

type Account = {
  user: User;
  credentials: Credential[];
};

type PushSubscription = {
  id: string;
  endpoint: string;
  updatedAt: string;
  metadata?: {
    deviceName?: string;
    userAgent?: string;
    language?: string;
    timezone?: string;
    lastSuccessfulSendAt?: string;
    lastError?: string;
    lastErrorAt?: string;
  };
};

type State = {
  account: Account | null;
  credentials: Credential[];
  push: {
    supported: boolean;
    permission: NotificationPermission;
    registration: ServiceWorkerRegistration | null;
    vapidPublicKey: string | null;
    subscriptions: PushSubscription[];
    currentId: string | null;
    loading: boolean;
  };
};

const state: State = {
  account: null,
  credentials: [],
  push: {
    supported: "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
    permission: typeof Notification !== "undefined"
      ? Notification.permission
      : "default",
    registration: null,
    vapidPublicKey: null,
    subscriptions: [],
    currentId: null,
    loading: false,
  },
};

let statusHideTimeout = 0;
let statusAnimationFrame = 0;

const normalizeUsername = (value: string | undefined): string =>
  typeof value === "string" ? value.trim() : "";
const getAccountUsername = (): string =>
  normalizeUsername(state.account?.user?.username ?? "");
const getInputUsername = (): string =>
  normalizeUsername(accountUsernameInput.value);
const updateProfileSubmitState = () => {
  if (profileForm.dataset.loading === "true") {
    profileSubmitButton.disabled = true;
    return;
  }
  if (!state.account) {
    profileSubmitButton.disabled = true;
    return;
  }
  const inputUsername = getInputUsername();
  if (!inputUsername) {
    profileSubmitButton.disabled = true;
    return;
  }
  profileSubmitButton.disabled =
    inputUsername === getAccountUsername();
};

const setStatus = (
  message: string,
  status: "info" | "error" | "success" = "info",
  { autoHide = false, timeout = 4000 } = {},
) => {
  statusEl.textContent = message;
  statusEl.dataset.status = status;
  statusEl.dataset.visible = "false";
  if (statusAnimationFrame) {
    cancelAnimationFrame(statusAnimationFrame);
  }
  if (statusHideTimeout) {
    clearTimeout(statusHideTimeout);
    statusHideTimeout = 0;
  }
  statusAnimationFrame = requestAnimationFrame(() => {
    statusAnimationFrame = 0;
    statusEl.dataset.visible = "true";
    if (autoHide) {
      statusHideTimeout = setTimeout(() => {
        statusHideTimeout = 0;
        statusEl.dataset.visible = "false";
      }, timeout);
    }
  });
};

const formatDate = (value: string): string => {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }
    return date.toLocaleString();
  } catch {
    return "-";
  }
};

const base64UrlToUint8Array = (value: string): Uint8Array => {
  const padded = value.padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    "=",
  );
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
};

const detectDeviceName = (): string => {
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

const collectPushMetadata = () => {
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timezone = undefined;
  }
  return {
    deviceName: detectDeviceName(),
    userAgent: navigator.userAgent,
    language: typeof navigator.language === "string"
      ? navigator.language
      : undefined,
    timezone,
  };
};

const updatePushSummary = () => {
  if (!pushSummary) return;
  if (!state.account) {
    pushSummary.textContent =
      "通知を有効化するにはサインインしてください。";
    enablePushButton.disabled = true;
    return;
  }
  if (!state.push.supported) {
    pushSummary.textContent =
      "このブラウザーは Web Push に対応していません。対応ブラウザーでお試しください。";
    enablePushButton.disabled = true;
    return;
  }
  const permission = typeof Notification !== "undefined"
    ? Notification.permission
    : "default";
  state.push.permission = permission;
  if (permission === "denied") {
    pushSummary.textContent =
      "通知がブロックされています。ブラウザーの設定から通知を許可してください。";
    enablePushButton.disabled = true;
    return;
  }
  if (permission === "granted") {
    pushSummary.textContent =
      "通知が許可されています。テスト通知を送信して動作を確認できます。";
    enablePushButton.disabled = state.push.loading;
    enablePushButton.textContent = state.push.currentId
      ? "このデバイスを更新"
      : "通知を有効化";
    return;
  }
  pushSummary.textContent =
    "通知を許可するとサインイン時にスマートフォンへプッシュ通知を送れます。";
  enablePushButton.disabled = state.push.loading;
  enablePushButton.textContent = "通知を有効化";
};

const renderPushSubscriptions = (subscriptions: PushSubscription[]) => {
  pushSubscriptionList.innerHTML = "";
  updatePushSummary();
  if (!state.account) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "サインインして通知設定を管理してください。";
    pushSubscriptionList.append(li);
    return;
  }
  if (!state.push.supported) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent =
      "このブラウザーは Web Push に対応していません。";
    pushSubscriptionList.append(li);
    return;
  }
  if (!subscriptions.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent =
      "まだ通知を受け取るデバイスが登録されていません。";
    pushSubscriptionList.append(li);
    return;
  }
  for (const subscription of subscriptions) {
    const li = document.createElement("li");

    const header = document.createElement("div");
    header.className = "credential-header";
    const title = document.createElement("strong");
    const deviceName =
      subscription.metadata?.deviceName?.trim() ||
      "登録済みデバイス";
    title.textContent = deviceName;
    header.append(title);
    if (
      state.push.currentId &&
      state.push.currentId === subscription.id
    ) {
      const badge = document.createElement("span");
      badge.className = "tag success";
      badge.textContent = "このデバイス";
      header.append(badge);
    }
    li.append(header);

    const meta = document.createElement("dl");
    meta.className = "credential-meta";
    const addMetaRow = (label: string, value: string) => {
      const row = document.createElement("div");
      const labelEl = document.createElement("dt");
      labelEl.textContent = label;
      const valueEl = document.createElement("dd");
      valueEl.textContent = value;
      valueEl.style.fontWeight = "500";
      row.append(labelEl, valueEl);
      meta.append(row);
    };

    addMetaRow("更新日", formatDate(subscription.updatedAt));
    addMetaRow(
      "最終通知",
      subscription.metadata?.lastSuccessfulSendAt
        ? formatDate(subscription.metadata.lastSuccessfulSendAt)
        : "-",
    );
    if (subscription.metadata?.lastError) {
      const message = subscription.metadata.lastError;
      const timestamp = subscription.metadata.lastErrorAt
        ? ` (${formatDate(subscription.metadata.lastErrorAt)})`
        : "";
      addMetaRow("状態", `${message}${timestamp}`);
    } else {
      addMetaRow("状態", "正常");
    }

    li.append(meta);

    const actions = document.createElement("div");
    actions.className = "credential-editor-actions";
    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.className = "link";
    renameButton.dataset.action = "edit-subscription";
    renameButton.dataset.subscriptionId = subscription.id;
    renameButton.textContent = "名前を変更";
    actions.append(renameButton);
    const testButton = document.createElement("button");
    testButton.type = "button";
    testButton.className = "secondary";
    testButton.dataset.action = "test-subscription";
    testButton.dataset.subscriptionId = subscription.id;
    testButton.textContent = "テスト通知";
    actions.append(testButton);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "danger outline";
    removeButton.dataset.action = "remove-subscription";
    removeButton.dataset.subscriptionId = subscription.id;
    removeButton.textContent = "解除";
    actions.append(removeButton);

    li.append(actions);
    pushSubscriptionList.append(li);
  }
};

const updateView = () => {
  accountView.hidden = !state.account;
};

const renderCredentials = (credentials: Credential[]) => {
  credentialsList.innerHTML = "";
  if (!state.account) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "サインインするとパスキーが表示されます。";
    credentialsList.append(li);
    return;
  }
  if (!credentials.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "まだパスキーが登録されていません。";
    credentialsList.append(li);
    return;
  }
  for (const credential of credentials) {
    const fragment = credentialTemplate.content.cloneNode(true) as DocumentFragment;
    const title = fragment.querySelector(
      '[data-role="credential-title"]',
    )!;
    const created = fragment.querySelector(
      '[data-role="credential-created"]',
    )!;
    const lastUsed = fragment.querySelector(
      '[data-role="credential-last-used"]',
    )!;
    const editButton = fragment.querySelector(
      'button[data-action="edit-credential"]',
    )! as HTMLButtonElement;
    const deleteButton = fragment.querySelector(
      'button[data-action="delete-credential"]',
    )! as HTMLButtonElement;
    const fallbackName = "名前のないデバイス";
    const originalNickname = credential.nickname?.trim() ?? "";
    const displayName = originalNickname || fallbackName;
    title.textContent = displayName;
    editButton.dataset.credentialId = credential.id;
    deleteButton.dataset.credentialId = credential.id;
    created.textContent = formatDate(credential.createdAt);
    lastUsed.textContent = credential.lastUsedAt
      ? formatDate(credential.lastUsedAt)
      : "-";
    credentialsList.append(fragment);
  }
};

const renderAccount = () => {
  const account = state.account;
  if (!account) {
    accountUsernameInput.value = "";
    renderCredentials([]);
    state.push.subscriptions = [];
    state.push.currentId = null;
    renderPushSubscriptions([]);
    updateView();
    updateProfileSubmitState();
    return;
  }
  const { user, credentials } = account;
  accountUsernameInput.value = user.username;
  renderCredentials(credentials);
  renderPushSubscriptions(state.push.subscriptions);
  updateView();
  updateProfileSubmitState();
};

const setAccount = (account: Account | null) => {
  if (account && account.user) {
    state.account = {
      user: account.user,
      credentials: Array.isArray(account.credentials)
        ? account.credentials
        : [],
    };
    state.credentials = state.account.credentials;
  } else {
    state.account = null;
    state.credentials = [];
  }
  renderAccount();
};

const clearAccount = () => {
  setAccount(null);
};

const getSession = async (): Promise<{ user: User } | null> => {
  try {
    const response = await fetch("/session", {
      credentials: "include",
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
};

const extractErrorMessage = async (response: Response): Promise<string> => {
  try {
    const json = await response.clone().json();
    if (json && typeof json === "object" && "message" in json) {
      const message = json.message;
      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
    }
  } catch {
    // ignore
  }
  try {
    const text = await response.text();
    if (text.trim()) {
      return text.trim();
    }
  } catch {
    // ignore
  }
  return `リクエストがステータス${response.status}で失敗しました`;
};

const fetchAccount = async (): Promise<Account> => {
  const response = await fetch("/webauthn/credentials", {
    credentials: "include",
  });
  if (response.status === 401) {
    throw new Error("サインインが必要です。");
  }
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  const data = await response.json();
  if (!data || typeof data !== "object" || !data.user) {
    throw new Error("アカウントが見つかりません。");
  }
  const credentials = Array.isArray(data.credentials)
    ? data.credentials
    : [];
  return { user: data.user, credentials };
};

const loadAccount = async (): Promise<Account> => {
  const account = await fetchAccount();
  setAccount(account);
  return account;
};

const refreshAccount = async () => {
  if (!state.account) {
    return;
  }
  try {
    await loadAccount();
  } catch (error) {
    setStatus(
      error instanceof Error ? (error.message ?? "アカウントを更新できません。") : "アカウントを更新できません。",
      "error",
    );
  }
};

const ensureServiceWorkerRegistration = async (): Promise<ServiceWorkerRegistration> => {
  if (!state.push.supported) {
    throw new Error("このブラウザーでは通知を利用できません。");
  }
  if (state.push.registration) {
    return state.push.registration;
  }
  try {
    if (!navigator.serviceWorker.controller) {
      await navigator.serviceWorker.register("/sw.js");
    }
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    state.push.registration = registration;
    return registration;
  } catch (error) {
    throw new Error("サービスワーカーを初期化できませんでした。");
  }
};

const fetchVapidKey = async (): Promise<string> => {
  if (state.push.vapidPublicKey) {
    return state.push.vapidPublicKey;
  }
  const response = await fetch("/push/vapid-key", {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  const data = await response.json();
  if (!data || typeof data !== "object" || !data.publicKey) {
    throw new Error("サーバーから鍵を取得できませんでした。");
  }
  state.push.vapidPublicKey = data.publicKey;
  return data.publicKey;
};

const ensureNotificationPermission = async (): Promise<NotificationPermission> => {
  if (!state.push.supported) {
    throw new Error("このブラウザーでは通知を利用できません。");
  }
  if (Notification.permission === "granted") {
    return "granted";
  }
  if (Notification.permission === "denied") {
    return "denied";
  }
  const permission = await Notification.requestPermission();
  state.push.permission = permission;
  return permission;
};

const loadPushSubscriptions = async (initial = false) => {
  if (!state.account) {
    state.push.subscriptions = [];
    state.push.currentId = null;
    renderPushSubscriptions([]);
    return;
  }
  if (!state.push.supported) {
    renderPushSubscriptions([]);
    return;
  }
  try {
    const response = await fetch("/push/subscriptions", {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(await extractErrorMessage(response));
    }
    const data = await response.json();
    const subscriptions = Array.isArray(data.subscriptions)
      ? data.subscriptions
      : [];
    state.push.subscriptions = subscriptions;
    if (initial) {
      try {
        const registration = await navigator.serviceWorker
          .getRegistration();
        if (registration) {
          const existing = await registration.pushManager
            .getSubscription();
          if (existing) {
            const match = subscriptions.find((item: PushSubscription) =>
              item.endpoint === existing.endpoint
            );
            if (match) {
              state.push.currentId = match.id;
            }
          }
        }
      } catch (error) {
        console.warn(
          "Failed to match existing push subscription",
          error,
        );
      }
    } else if (state.push.currentId) {
      const stillExists = subscriptions.some((item: PushSubscription) =>
        item.id === state.push.currentId
      );
      if (!stillExists) {
        state.push.currentId = null;
      }
    }
    renderPushSubscriptions(subscriptions);
  } catch (error) {
    console.error("Failed to load push subscriptions:", error);
    state.push.subscriptions = [];
    state.push.currentId = null;
    renderPushSubscriptions([]);
    setStatus(
      error instanceof Error && error.message
        ? `通知設定を取得できませんでした: ${error.message}`
        : "通知設定を取得できませんでした。",
      "error",
    );
  }
};

const subscribeCurrentDevice = async () => {
  if (state.push.loading) {
    return;
  }
  if (!state.account) {
    setStatus(
      "通知を設定する前にサインインしてください。",
      "error",
    );
    return;
  }
  state.push.loading = true;
  enablePushButton.dataset.loading = "true";
  enablePushButton.disabled = true;
  try {
    const permission = await ensureNotificationPermission();
    if (permission !== "granted") {
      throw new Error(
        "通知が許可されていません。ブラウザーの設定をご確認ください。",
      );
    }
    const registration = await ensureServiceWorkerRegistration();
    const existing = await registration.pushManager
      .getSubscription();
    const subscription = existing ??
      await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(
          await fetchVapidKey(),
        ),
      });
    const response = await fetch("/push/subscriptions", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        metadata: collectPushMetadata(),
      }),
    });
    if (!response.ok) {
      throw new Error(await extractErrorMessage(response));
    }
    const data = await response.json();
    if (data?.subscription?.id) {
      state.push.currentId = data.subscription.id;
    }
    setStatus("通知を有効化しました。", "success");
    await loadPushSubscriptions();
  } catch (error) {
    setStatus(
      error instanceof Error && error.message
        ? `通知を有効にできませんでした: ${error.message}`
        : "通知を有効にできませんでした。",
      "error",
    );
  } finally {
    state.push.loading = false;
    enablePushButton.dataset.loading = "false";
    enablePushButton.disabled = false;
    updatePushSummary();
  }
};

const removeSubscription = async (id: string) => {
  if (!id) return;
  const confirmed = window.confirm(
    "このデバイスの通知登録を解除しますか？",
  );
  if (!confirmed) {
    return;
  }
  try {
    const response = await fetch(
      `/push/subscriptions/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        credentials: "include",
      },
    );
    if (!response.ok) {
      throw new Error(await extractErrorMessage(response));
    }
    if (state.push.currentId === id) {
      try {
        const registration =
          await ensureServiceWorkerRegistration();
        const subscription = await registration.pushManager
          .getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
        }
      } catch (error) {
        console.warn("Failed to unsubscribe push manager", error);
      }
      state.push.currentId = null;
    }
    setStatus("通知の登録を解除しました。", "success");
    await loadPushSubscriptions();
  } catch (error) {
    setStatus(
      error instanceof Error && error.message
        ? `通知の解除に失敗しました: ${error.message}`
        : "通知の解除に失敗しました。",
      "error",
    );
  }
};

const sendTestNotification = async (id: string, button?: HTMLButtonElement) => {
  if (!id) return;
  if (button) {
    button.dataset.loading = "true";
    button.disabled = true;
  }
  try {
    const response = await fetch("/push/notifications/test", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscriptionId: id }),
    });
    if (!response.ok) {
      throw new Error(await extractErrorMessage(response));
    }
    const data = await response.json();
    const warnings = Array.isArray(data?.warnings)
      ? data.warnings
        .filter((item: unknown) => typeof item === "string" && (item as string).trim())
        .map((item: unknown) => (item as string).trim())
      : [];
    if (data?.removed) {
      const removalNotice = warnings.length
        ? `通知の登録を削除しました。${warnings.join(" ")}`
        : "通知が無効になっていたため登録を削除しました。";
      setStatus(removalNotice, "info");
    } else {
      const suffix = warnings.length
        ? `（${warnings.join(" ")}）`
        : "";
      setStatus(`テスト通知を送信しました。${suffix}`, "success");
    }
    if (warnings.length) {
      console.warn("Push notification warnings:", warnings);
    }
    await loadPushSubscriptions();
  } catch (error) {
    setStatus(
      error instanceof Error && error.message
        ? `テスト通知の送信に失敗しました: ${error.message}`
        : "テスト通知の送信に失敗しました。",
      "error",
    );
  } finally {
    if (button) {
      button.dataset.loading = "false";
      button.disabled = false;
    }
  }
};

logoutButton.addEventListener("click", async () => {
  if (logoutButton.dataset.loading === "true") {
    return;
  }
  logoutButton.dataset.loading = "true";
  logoutButton.disabled = true;
  try {
    const response = await fetch("/session/logout", {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(await extractErrorMessage(response));
    }
    clearAccount();
    window.location.href = "/";
  } catch (error) {
    setStatus(
      error instanceof Error && error.message
        ? `サインアウトに失敗しました: ${error.message}`
        : "サインアウトに失敗しました。",
      "error",
    );
  } finally {
    logoutButton.dataset.loading = "false";
    logoutButton.disabled = false;
  }
});

deleteAccountButton.addEventListener("click", async () => {
  if (!state.account) {
    setStatus(
      "アカウントを削除する前にサインインしてください。",
      "error",
    );
    return;
  }
  if (deleteAccountButton.dataset.loading === "true") {
    return;
  }
  const confirmed = window.confirm(
    "アカウントを削除するとすべてのパスキーが消えます。この操作は取り消せません。続行しますか？",
  );
  if (!confirmed) {
    return;
  }
  deleteAccountButton.dataset.loading = "true";
  deleteAccountButton.disabled = true;
  try {
    const response = await fetch("/account", {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(await extractErrorMessage(response));
    }
    clearAccount();
    window.location.href = "/";
  } catch (error) {
    setStatus(
      error instanceof Error && error.message
        ? `アカウントの削除に失敗しました: ${error.message}`
        : "アカウントの削除に失敗しました。",
      "error",
    );
  } finally {
    deleteAccountButton.dataset.loading = "false";
    deleteAccountButton.disabled = false;
  }
});

addPasskeyButton.addEventListener("click", () => {
  if (!state.account) {
    setStatus(
      "新しいパスキーを追加する前にサインインしてください。",
      "error",
    );
    return;
  }
  try {
    passkeyDialog.showModal();
    passkeyDialogSubmit.focus();
  } catch (error) {
    console.error("Unable to open passkey dialog:", error);
  }
});

passkeyDialogCancel.addEventListener("click", () => {
  passkeyDialog.close();
});

passkeyDialog.addEventListener("close", () => {
  passkeyForm.dataset.loading = "false";
  passkeyDialogSubmit.disabled = false;
});

credentialDialogCancel.addEventListener("click", () => {
  credentialDialog.close();
});

credentialDialog.addEventListener("close", () => {
  credentialForm.dataset.loading = "false";
  credentialDialogSubmit.disabled = false;
  credentialForm.dataset.credentialId = "";
  credentialForm.dataset.originalNickname = "";
  credentialForm.reset();
});

pushDeviceDialogCancel.addEventListener("click", () => {
  pushDeviceDialog.close();
});

pushDeviceDialog.addEventListener("close", () => {
  pushDeviceForm.dataset.loading = "false";
  pushDeviceDialogSubmit.disabled = false;
  pushDeviceForm.dataset.subscriptionId = "";
  pushDeviceForm.dataset.originalName = "";
  pushDeviceForm.reset();
});

enablePushButton.addEventListener("click", async () => {
  await subscribeCurrentDevice();
});

pushSubscriptionList.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest("button");
  if (!button) return;
  const action = button.dataset.action;
  const subscriptionId = button.dataset.subscriptionId;
  if (!action || !subscriptionId) {
    return;
  }
  if (button.dataset.loading === "true") {
    return;
  }
  if (action === "edit-subscription") {
    const subscription = state.push.subscriptions.find((item) =>
      item.id === subscriptionId
    );
    if (!subscription) {
      setStatus(
        "通知デバイスを読み込めませんでした。",
        "error",
      );
      return;
    }
    const originalName =
      subscription.metadata?.deviceName?.trim() ??
        "";
    pushDeviceForm.dataset.loading = "false";
    pushDeviceDialogSubmit.disabled = false;
    pushDeviceForm.dataset.subscriptionId = subscription.id;
    pushDeviceForm.dataset.originalName = originalName;
    pushDeviceDialogName.value = originalName;
    try {
      pushDeviceDialog.showModal();
      pushDeviceDialogName.focus();
      pushDeviceDialogName.select();
    } catch (error) {
      console.error("Unable to open push device dialog:", error);
    }
    return;
  }
  if (action === "remove-subscription") {
    button.dataset.loading = "true";
    button.disabled = true;
    try {
      await removeSubscription(subscriptionId);
    } finally {
      button.dataset.loading = "false";
      button.disabled = false;
    }
    return;
  }
  if (action === "test-subscription") {
    await sendTestNotification(subscriptionId, button as HTMLButtonElement);
  }
});

pushDeviceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.account) {
    setStatus(
      "通知デバイスを管理する前にサインインしてください。",
      "error",
    );
    return;
  }
  if (pushDeviceForm.dataset.loading === "true") {
    return;
  }
  const subscriptionId = pushDeviceForm.dataset.subscriptionId;
  if (!subscriptionId) {
    return;
  }
  const normalizedName = pushDeviceDialogName.value.trim();
  if (!normalizedName) {
    setStatus("通知デバイスの名前を入力してください。", "error");
    pushDeviceDialogName.focus();
    return;
  }
  const originalName = (pushDeviceForm.dataset.originalName ?? "")
    .trim();
  if (normalizedName === originalName) {
    setStatus("保存する変更がありません。", "info");
    pushDeviceDialogName.focus();
    return;
  }
  pushDeviceForm.dataset.loading = "true";
  pushDeviceDialogSubmit.disabled = true;
  try {
    const response = await fetch(
      `/push/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { deviceName: normalizedName },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(await extractErrorMessage(response));
    }
    setStatus(
      `通知デバイスの名前を「${normalizedName}」に更新しました。`,
      "success",
      { autoHide: true },
    );
    pushDeviceDialog.close();
    await loadPushSubscriptions();
  } catch (error) {
    setStatus(
      error instanceof Error && error.message
        ? `通知デバイスの更新に失敗しました: ${error.message}`
        : "通知デバイスの更新に失敗しました。",
      "error",
    );
  } finally {
    pushDeviceForm.dataset.loading = "false";
    pushDeviceDialogSubmit.disabled = false;
  }
});

credentialForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.account) {
    setStatus(
      "パスキーを管理する前にサインインしてください。",
      "error",
    );
    return;
  }
  if (credentialForm.dataset.loading === "true") {
    return;
  }
  const credentialId = credentialForm.dataset.credentialId;
  if (!credentialId) {
    return;
  }
  const normalizedNickname = credentialDialogNickname.value
    .trim();
  if (!normalizedNickname) {
    setStatus("パスキーの名前を入力してください。", "error");
    credentialDialogNickname.focus();
    return;
  }
  const original = (credentialForm.dataset.originalNickname ?? "")
    .trim();
  if (normalizedNickname === original) {
    setStatus("保存する変更がありません。", "info");
    credentialDialogNickname.focus();
    return;
  }
  credentialForm.dataset.loading = "true";
  credentialDialogSubmit.disabled = true;
  try {
    const updated = await client.update({
      credentialId,
      nickname: normalizedNickname,
    });
    const nickname = updated.credential?.nickname?.trim() ||
      normalizedNickname;
    setStatus(
      `パスキーの名前を「${nickname}」に更新しました。`,
      "success",
      { autoHide: true },
    );
    credentialDialog.close();
    await refreshAccount();
  } catch (error) {
    setStatus(
      error instanceof Error && error.message
        ? `名前の更新に失敗しました: ${error.message}`
        : "名前の更新に失敗しました。",
      "error",
    );
  } finally {
    credentialForm.dataset.loading = "false";
    credentialDialogSubmit.disabled = false;
  }
});

passkeyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (passkeyForm.dataset.loading === "true") {
    return;
  }
  if (!state.account) {
    setStatus(
      "サインイン中のアカウントがありません。",
      "error",
    );
    return;
  }
  passkeyForm.dataset.loading = "true";
  passkeyDialogSubmit.disabled = true;
  try {
    setStatus("セキュリティキーの操作を待機しています…");
    const result = await client.register({
      username: state.account.user.username,
    });
    const nickname = result?.credential?.nickname?.trim();
    setStatus(
      nickname
        ? `パスキー「${nickname}」を追加しました。`
        : "パスキーを追加しました。",
      "success",
    );
    passkeyDialog.close();
    await refreshAccount();
  } catch (error) {
    let message = "パスキーの設定に失敗しました。";
    let statusType: "info" | "error" | "success" = "error";
    if (error instanceof DOMException) {
      switch (error.name) {
        case "NotAllowedError":
          message =
            "このデバイスには既にこのアカウントのパスキーがあります。別の認証器を使用するか既存の鍵を削除してください。";
          break;
        case "InvalidStateError":
          message =
            "この認証器は既にこのアカウントに登録されているため要求を拒否しました。";
          break;
        case "AbortError":
          message = "パスキーの設定がキャンセルされました。";
          statusType = "info";
          break;
        default:
          if (error.message?.trim()) {
            message =
              `パスキーの設定に失敗しました: ${error.message}`;
          }
          break;
      }
    } else if (error instanceof Error && error.message.trim()) {
      message = `パスキーの設定に失敗しました: ${error.message}`;
    }
    setStatus(message, statusType);
  } finally {
    passkeyDialogSubmit.disabled = false;
    passkeyForm.dataset.loading = "false";
  }
});

credentialsList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest("button[data-credential-id]");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  if (!state.account) {
    setStatus(
      "パスキーを管理する前にサインインしてください。",
      "error",
    );
    return;
  }
  const credentialId = button.dataset.credentialId;
  if (!credentialId) {
    return;
  }
  const action = button.dataset.action;
  if (action === "edit-credential") {
    const credential = state.credentials.find((item) =>
      item.id === credentialId
    );
    if (!credential) {
      setStatus(
        "パスキーを読み込めませんでした。",
        "error",
      );
      return;
    }
    const nickname = credential.nickname?.trim() ?? "";
    credentialForm.dataset.loading = "false";
    credentialDialogSubmit.disabled = false;
    credentialForm.dataset.credentialId = credential.id;
    credentialForm.dataset.originalNickname = nickname;
    credentialDialogNickname.value = nickname;
    try {
      credentialDialog.showModal();
      credentialDialogNickname.focus();
      credentialDialogNickname.select();
    } catch (error) {
      console.error("Unable to open credential dialog:", error);
    }
    return;
  }
  if (action !== "delete-credential") {
    return;
  }
  if (button.dataset.loading === "true") {
    return;
  }
  button.dataset.loading = "true";
  button.disabled = true;
  try {
    setStatus("パスキーを削除しています…");
    await client.delete({
      credentialId,
    });
    setStatus("パスキーを削除しました。", "success");
    await refreshAccount();
  } catch (error) {
    setStatus(
      error instanceof Error && error.message
        ? `パスキーの削除に失敗しました: ${error.message}`
        : "パスキーの削除に失敗しました。",
      "error",
    );
  } finally {
    button.dataset.loading = "false";
    button.disabled = false;
  }
});

accountUsernameInput.addEventListener("input", () => {
  updateProfileSubmitState();
});

updateProfileSubmitState();

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.account) {
    setStatus(
      "プロフィールを更新する前にサインインしてください。",
      "error",
    );
    return;
  }
  if (profileForm.dataset.loading === "true") {
    return;
  }
  const username = accountUsernameInput.value.trim();
  const payload: { username?: string } = {};
  if (username && username !== state.account.user.username) {
    payload.username = username;
  }
  if (Object.keys(payload).length === 0) {
    setStatus("保存する変更がありません。", "info");
    return;
  }
  profileForm.dataset.loading = "true";
  profileSubmitButton.disabled = true;
  try {
    const response = await fetch("/account", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await extractErrorMessage(response));
    }
    const data = await response.json();
    if (!data || typeof data !== "object" || !data.user) {
      throw new Error("サーバーから予期しない応答がありました。");
    }
    state.account = {
      user: data.user,
      credentials: state.credentials,
    };
    renderAccount();
    setStatus("プロフィールを更新しました。", "success");
  } catch (error) {
    setStatus(
      error instanceof Error && error.message
        ? `プロフィールの保存に失敗しました: ${error.message}`
        : "プロフィールの保存に失敗しました。",
      "error",
    );
  } finally {
    profileForm.dataset.loading = "false";
    updateProfileSubmitState();
  }
});

const initialise = async () => {
  setStatus("アカウント情報を読み込んでいます…");
  const session = await getSession();
  if (!session?.user) {
    window.location.href = "/";
    return;
  }
  try {
    await loadAccount();
    await loadPushSubscriptions(true);
    setStatus("", "success", { autoHide: true });
  } catch (error) {
    console.error("Failed to restore session:", error);
    clearAccount();
    setStatus(
      "アカウント情報を取得できませんでした。もう一度サインインしてください。",
      "error",
    );
    window.location.href = "/";
  }
};

await initialise();

statusEl.addEventListener("click", () => {
  if (statusHideTimeout) {
    clearTimeout(statusHideTimeout);
    statusHideTimeout = 0;
  }
  if (statusAnimationFrame) {
    cancelAnimationFrame(statusAnimationFrame);
    statusAnimationFrame = 0;
  }
  statusEl.dataset.visible = "false";
});
