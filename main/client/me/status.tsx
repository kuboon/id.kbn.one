/**
 * Inline status alert shared by the `/me` islands. Each island owns its own
 * status state (there is no page-level toast in the islands layout), so this
 * is a plain render helper — call it as a function, not as a `<Component/>`.
 */

import { on, type RemixNode } from "@remix-run/ui";

import type { AlertKind } from "./util.ts";

export interface InlineStatus {
  message: string;
  kind: AlertKind;
}

export const statusAlert = (
  status: InlineStatus | null,
  onDismiss: () => void,
): RemixNode => {
  if (!status) return null;
  return (
    <div
      role="status"
      class={`alert alert-${status.kind} alert-soft`}
      mix={[on("click", () => onDismiss())]}
    >
      <span>{status.message}</span>
    </div>
  );
};
