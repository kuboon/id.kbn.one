import { createClient } from "@kuboon/passkeys/client.ts";
import { init } from "@kuboon/dpop";

const { fetchDpop } = await init();
const client = createClient({ fetch: fetchDpop });

const guestForm = document.getElementById("guest-form") as HTMLFormElement;
const statusEl = document.getElementById("conditional-status")!;
const createAccountButton = document.getElementById(
  "open-create-account",
) as HTMLButtonElement;

const state = { conditionalAvailable: false };

const ALERT_CLASSES = [
  "alert-info",
  "alert-success",
  "alert-warning",
  "alert-error",
];

const setStatus = (
  message: string,
  kind: "info" | "success" | "warning" | "error" = "info",
) => {
  const wrapper = statusEl.closest(".alert");
  if (wrapper) {
    wrapper.classList.remove(...ALERT_CLASSES);
    wrapper.classList.add(`alert-${kind}`);
  }
  statusEl.textContent = message;
  statusEl.dataset.state = kind;
};

const getSession = async (): Promise<{ userId?: string } | null> => {
  try {
    const response = await fetchDpop("/session");
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
};

const goToDashboard = async () => {
  const session = await getSession();
  if (session?.userId) {
    globalThis.location.href = "/me";
    return true;
  }
  throw new Error("サインインできませんでした。もう一度お試しください。");
};

const checkConditionalMediation = async () => {
  if (
    typeof PublicKeyCredential === "undefined" ||
    typeof PublicKeyCredential.isConditionalMediationAvailable !== "function"
  ) {
    setStatus(
      "ご利用のブラウザーはまだパスキーの自動入力に対応していません。",
      "warning",
    );
    state.conditionalAvailable = false;
    return;
  }
  try {
    const available = await PublicKeyCredential
      .isConditionalMediationAvailable();
    state.conditionalAvailable = available;
    setStatus(
      available
        ? "このブラウザーではパスキーの自動入力が利用できます。"
        : "パスキーの自動入力は無効です。手動でサインインできます。",
      available ? "info" : "warning",
    );
  } catch (error) {
    console.error("Failed to detect conditional mediation:", error);
    setStatus(
      "パスキーの自動入力に対応しているか判定できませんでした。",
      "error",
    );
    state.conditionalAvailable = false;
  }
};

guestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (guestForm.dataset.loading === "true") return;
  if (!state.conditionalAvailable) {
    setStatus(
      "このブラウザーではパスキーの自動入力が利用できません。アカウントを作成するかユーザー名でサインインしてください。",
      "info",
    );
    return;
  }
  guestForm.dataset.loading = "true";
  try {
    setStatus("パスキーの操作を待機しています…");
    await client.authenticate();
    setStatus("サインインに成功しました。", "success");
    await goToDashboard();
  } catch (error) {
    console.error("Authentication failed:", error);
    const message = error instanceof Error ? error.message : String(error);
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
  if (createAccountButton.dataset.loading === "true") return;
  const userId = prompt("パスキーに登録するユーザー名を入力してください:")
    ?.trim();
  if (!userId) {
    setStatus("ユーザー名が入力されませんでした。", "info");
    return;
  }
  createAccountButton.dataset.loading = "true";
  createAccountButton.disabled = true;
  try {
    setStatus("セキュリティキーの操作を待機しています…");
    await client.register({ userId });
    setStatus("アカウントを作成しました。", "success");
    await goToDashboard();
  } catch (error) {
    let message = "パスキーの設定に失敗しました。";
    let kind: "info" | "error" = "error";
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
          kind = "info";
          break;
        default:
          if (error.message?.trim()) {
            message = `パスキーの設定に失敗しました: ${error.message}`;
          }
      }
    } else if (error instanceof Error && error.message.trim()) {
      message = `パスキーの設定に失敗しました: ${error.message}`;
    }
    setStatus(message, kind);
  } finally {
    createAccountButton.dataset.loading = "false";
    createAccountButton.disabled = false;
  }
});

await checkConditionalMediation();
const session = await getSession();
if (session?.userId) {
  globalThis.location.href = "/me";
}
