import { createClient } from "@kuboon/passkeys/client.ts";
import { init } from "@kuboon/dpop";

const { fetchDpop } = await init();
const client = createClient({ fetch: fetchDpop });

const statusEl = document.getElementById("status")!;
const rpOriginEl = document.getElementById("rp-origin")!;
const signinActions = document.getElementById("signin-actions")!;
const signinButton = document.getElementById("signin") as HTMLButtonElement;
const createAccountButton = document.getElementById(
  "create-account",
) as HTMLButtonElement;

const ALERT_CLASSES = [
  "alert-info",
  "alert-success",
  "alert-warning",
  "alert-error",
];

const setStatus = (
  message: string,
  state: "info" | "success" | "warning" | "error" = "info",
) => {
  statusEl.textContent = message;
  statusEl.dataset.state = state;
  const wrapper = statusEl.closest(".alert");
  if (wrapper) {
    wrapper.classList.remove(...ALERT_CLASSES);
    wrapper.classList.add(`alert-${state}`);
  }
};

const params = new URLSearchParams(globalThis.location.search);
const dpopJkt = params.get("dpop_jkt") ?? "";
const redirectUri = params.get("redirect_uri") ?? "";

if (!dpopJkt || !redirectUri) {
  setStatus(
    "サインインリクエストが正しくありません。元のサイトに戻ってやり直してください。",
    "error",
  );
  throw new Error("Missing dpop_jkt or redirect_uri");
}

try {
  const rpUrl = new URL(redirectUri);
  rpOriginEl.textContent = `${rpUrl.origin} からのサインインリクエストです。`;
  rpOriginEl.hidden = false;
} catch {
  // server already validated; defensive only
}

const getSession = async (): Promise<{ userId: string | null } | null> => {
  try {
    const response = await fetchDpop("/session");
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
};

const bindAndRedirect = async () => {
  setStatus("セッションを連携しています…");
  const response = await fetchDpop("/bind_session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dpop_jkt: dpopJkt }),
  });
  if (!response.ok) {
    let message = `セッションの連携に失敗しました (HTTP ${response.status})`;
    try {
      const data = await response.json();
      if (
        data && typeof data === "object" && typeof data.message === "string"
      ) {
        message = data.message;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  setStatus("リダイレクトしています…", "success");
  globalThis.location.replace(redirectUri);
};

const showSigninActions = (
  message: string,
  state: "info" | "success" | "warning" | "error" = "info",
) => {
  setStatus(message, state);
  signinActions.hidden = false;
};

const handleSigninError = (error: unknown, fallback: string) => {
  let message = fallback;
  if (error instanceof DOMException) {
    if (error.name === "AbortError") {
      message = "サインインがキャンセルされました。";
    } else if (error.message) {
      message = `${fallback}: ${error.message}`;
    }
  } else if (error instanceof Error && error.message) {
    message = `${fallback}: ${error.message}`;
  }
  setStatus(message, "error");
};

signinButton.addEventListener("click", async () => {
  if (signinButton.dataset.loading === "true") return;
  signinButton.dataset.loading = "true";
  signinButton.disabled = true;
  createAccountButton.disabled = true;
  try {
    setStatus("パスキーの操作を待機しています…");
    await client.authenticate();
    await bindAndRedirect();
  } catch (error) {
    handleSigninError(error, "サインインに失敗しました");
    signinButton.disabled = false;
    createAccountButton.disabled = false;
  } finally {
    signinButton.dataset.loading = "false";
  }
});

createAccountButton.addEventListener("click", async () => {
  if (createAccountButton.dataset.loading === "true") return;
  const userId = prompt(
    "パスキーに登録するユーザー名を入力してください:",
  )?.trim();
  if (!userId) {
    setStatus("ユーザー名が入力されませんでした。", "info");
    return;
  }
  createAccountButton.dataset.loading = "true";
  createAccountButton.disabled = true;
  signinButton.disabled = true;
  try {
    setStatus("セキュリティキーの操作を待機しています…");
    await client.register({ userId });
    await bindAndRedirect();
  } catch (error) {
    handleSigninError(error, "アカウントの作成に失敗しました");
    createAccountButton.disabled = false;
    signinButton.disabled = false;
  } finally {
    createAccountButton.dataset.loading = "false";
  }
});

const initialize = async () => {
  const session = await getSession();
  if (session?.userId) {
    try {
      await bindAndRedirect();
    } catch (error) {
      handleSigninError(error, "セッションの連携に失敗しました");
    }
    return;
  }
  showSigninActions("サインインしてください。");
};

await initialize();
