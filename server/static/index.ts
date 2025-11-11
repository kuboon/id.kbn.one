import { createClient } from "@scope/passkeys/static/client.ts";

const client = createClient();

const guestForm = document.getElementById("guest-form")!;
const conditionalStatus = document.getElementById(
  "conditional-status",
)!;
const createAccountButton = document.getElementById(
  "open-create-account",
) as HTMLButtonElement;
const state = {
  conditionalAvailable: false,
};

let defaultStatusText = conditionalStatus.textContent;
let defaultStatusState = conditionalStatus.dataset.state ||
  "pending";
let statusResetTimeout = 0;

const updateDefaultStatus = (message: string, status: string) => {
  defaultStatusText = message;
  defaultStatusState = status;
};

const setStatus = (
  message: string,
  status = "info",
  { autoHide = false, timeout = 4000 } = {},
) => {
  if (statusResetTimeout) {
    clearTimeout(statusResetTimeout);
    statusResetTimeout = 0;
  }
  conditionalStatus.textContent = message;
  conditionalStatus.dataset.state = status;
  if (autoHide) {
    statusResetTimeout = setTimeout(() => {
      statusResetTimeout = 0;
      conditionalStatus.textContent = defaultStatusText;
      conditionalStatus.dataset.state = defaultStatusState;
    }, timeout);
  }
};

const getSession = async () => {
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

const redirectToDashboard = async () => {
  const session = await getSession();
  if (session?.user) {
    globalThis.location.href = "/me";
    return true;
  }
  throw new Error(
    "サインインできませんでした。もう一度お試しください。",
  );
};

const authenticateWithPasskey = async () => {
  setStatus("パスキーの操作を待機しています…");
  if (!state.conditionalAvailable) {
    throw new Error("ユーザー名が必要です。");
  }
  await client.authenticate();
  setStatus("サインインに成功しました。", "success", { autoHide: true });
  await redirectToDashboard();
};

const checkConditionalMediation = async () => {
  if (
    typeof PublicKeyCredential === "undefined" ||
    typeof PublicKeyCredential.isConditionalMediationAvailable !==
      "function"
  ) {
    conditionalStatus.textContent =
      "ご利用のブラウザーはまだパスキーの自動入力に対応していません。";
    conditionalStatus.dataset.state = "unsupported";
    updateDefaultStatus(
      conditionalStatus.textContent,
      conditionalStatus.dataset.state,
    );
    state.conditionalAvailable = false;
    return false;
  }
  try {
    const available = await PublicKeyCredential
      .isConditionalMediationAvailable();
    state.conditionalAvailable = available;
    conditionalStatus.textContent = available
      ? "このブラウザーではパスキーの自動入力が利用できます。"
      : "パスキーの自動入力は無効です。手動でサインインできます。";
    conditionalStatus.dataset.state = available ? "available" : "absent";
    updateDefaultStatus(
      conditionalStatus.textContent,
      conditionalStatus.dataset.state,
    );
    return available;
  } catch (error) {
    console.error(
      "Failed to detect conditional mediation:",
      error,
    );
    conditionalStatus.textContent =
      "パスキーの自動入力に対応しているか判定できませんでした。";
    conditionalStatus.dataset.state = "error";
    updateDefaultStatus(
      conditionalStatus.textContent,
      conditionalStatus.dataset.state,
    );
    state.conditionalAvailable = false;
    return false;
  }
};

const generateRandomUsername = () => {
  const hex = () =>
    Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, "0");
  return `kbn-${Date.now().toString(36)}-${hex()}`;
};

guestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (guestForm.dataset.loading === "true") {
    return;
  }
  if (!state.conditionalAvailable) {
    setStatus(
      "このブラウザーではパスキーの自動入力が利用できません。アカウントを作成するかユーザー名でサインインしてください。",
      "info",
    );
    return;
  }
  guestForm.dataset.loading = "true";
  try {
    await authenticateWithPasskey();
  } catch (error) {
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? error.message
        : String(error);
    setStatus(
      message
        ? `サインインに失敗しました: ${message}`
        : "サインインがキャンセルされたか失敗しました。",
      "error",
    );
  } finally {
    guestForm.dataset.loading = "false";
  }
});

createAccountButton.addEventListener("click", async () => {
  if (createAccountButton.dataset.loading === "true") {
    return;
  }
  const username = generateRandomUsername();
  createAccountButton.dataset.loading = "true";
  createAccountButton.disabled = true;
  try {
    setStatus("セキュリティキーの操作を待機しています…");
    await client.register({ username });
    await redirectToDashboard();
    setStatus("アカウントを作成しました。", "success", {
      autoHide: true,
    });
  } catch (error) {
    let message = "パスキーの設定に失敗しました。";
    let statusType = "error";
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
            message = `パスキーの設定に失敗しました: ${error.message}`;
          }
          break;
      }
    } else if (error instanceof Error && error.message.trim()) {
      message = `パスキーの設定に失敗しました: ${error.message}`;
    }
    setStatus(message, statusType);
  } finally {
    createAccountButton.dataset.loading = "false";
    createAccountButton.disabled = false;
  }
});

const initialize = async () => {
  await checkConditionalMediation();
  const session = await getSession();
  if (session?.user) {
    globalThis.location.href = "/me";
    return;
  }
};

await initialize();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((error) => {
    console.warn("Service worker registration failed", error);
  });
}
