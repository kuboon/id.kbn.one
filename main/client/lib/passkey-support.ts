/**
 * Passkey capability handling shared by the pages that start a passkey
 * ceremony: the landing page and both authorize flows.
 *
 * `detectPasskeyStatus()` does more than the raw feature checks: it also
 * recognises the in-app browsers (LINE, Messenger, Instagram, …) that block
 * WebAuthn outright, which a capability probe cannot tell apart from a merely
 * old browser. That case matters most on `/authorize`, where the user arrives
 * by following a link from another site — often from inside such an app.
 */

import {
  detectPasskeyStatus,
  type PasskeyStatus,
} from "@kuboon/browser-how-to/passkeys";
import { showPasskeyGuide } from "@kuboon/browser-how-to/passkeys/ui";

export { detectPasskeyStatus, showPasskeyGuide };
export type PasskeySupport = PasskeyStatus["support"];

/** True when no passkey ceremony can complete here, whatever the user does. */
export const isPasskeyBlocked = (
  support: PasskeySupport | null,
): boolean => support === "unsupported" || support === "in-app-blocked";

/**
 * The notice to show for a support level that is not plain `"full"`, or
 * `null` when there is nothing to warn about. Callers own the `"full"` copy,
 * since what to say next differs per page.
 */
export const passkeySupportNotice = (
  support: PasskeySupport,
): { message: string; kind: "info" | "warning" } | null => {
  switch (support) {
    case "in-app-blocked":
      return {
        message:
          "アプリ内ブラウザーではパスキーを利用できません。手順を確認してください。",
        kind: "warning",
      };
    case "unsupported":
      return {
        message:
          "ご利用のブラウザーはパスキーに対応していません。手順を確認してください。",
        kind: "warning",
      };
    case "cross-device-only":
      return {
        message:
          "このデバイスにはパスキーを保存できません。スマートフォンのパスキーでサインインできます。",
        kind: "info",
      };
    case "full":
      return null;
  }
};
