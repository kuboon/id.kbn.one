/**
 * A yes/no question in a modal `<dialog>`, in place of `window.confirm()`.
 *
 * `confirm()` is not reliable: a browser may decline to show it and return
 * `false` on the spot — after the user ticked "prevent this page from creating
 * additional dialogs", when the tab is not focused, or inside an embedding
 * app — so the action silently never happens. A dialog the page draws itself
 * always appears.
 *
 * The buttons are submitters of a `<form method="dialog">`, which closes the
 * dialog with the pressed button's `value` as its `returnValue` and needs no
 * script. (Invoker commands would say the same with `commandfor`, but iOS
 * Safari only has them from 26.2.) Escape and the backdrop close it with no
 * value, which reads as "no".
 */

export interface ConfirmDialogOptions {
  /** Label of the button that answers yes. */
  confirmLabel?: string;
  /** Show the yes button as destructive. */
  danger?: boolean;
}

export const confirmDialog = (
  message: string,
  { confirmLabel = "OK", danger = false }: ConfirmDialogOptions = {},
): Promise<boolean> => {
  const dialog = document.createElement("dialog");
  dialog.className = "modal";

  const box = document.createElement("div");
  box.className = "modal-box";
  const text = document.createElement("p");
  text.className = "whitespace-pre-line";
  text.textContent = message;

  const actions = document.createElement("form");
  actions.method = "dialog";
  actions.className = "modal-action";
  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.value = "cancel";
  cancel.textContent = "キャンセル";
  const ok = document.createElement("button");
  ok.className = danger ? "btn btn-error" : "btn btn-primary";
  ok.value = "ok";
  ok.textContent = confirmLabel;
  actions.append(cancel, ok);
  box.append(text, actions);

  // daisyUI's backdrop: a click outside the box submits this empty form.
  const backdrop = document.createElement("form");
  backdrop.method = "dialog";
  backdrop.className = "modal-backdrop";
  const backdropButton = document.createElement("button");
  backdropButton.textContent = "閉じる";
  backdrop.append(backdropButton);

  dialog.append(box, backdrop);
  document.body.append(dialog);

  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "ok");
      dialog.remove();
    }, { once: true });
    dialog.showModal();
    // Focus the safe answer, so a stray Enter does not confirm.
    cancel.focus();
  });
};
