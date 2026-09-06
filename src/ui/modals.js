import { escapeHtml } from "./dom.js";

function makeBackdrop(documentRef, title, message) {
  const backdrop = documentRef.createElement("div");
  backdrop.className = "r4-tcm-modal-backdrop";
  backdrop.innerHTML = `<div class="r4-tcm-modal"><h3>${escapeHtml(title)}</h3><div>${message}</div><div class="r4-tcm-modal-actions"></div></div>`;
  documentRef.body.appendChild(backdrop);
  return backdrop;
}

function button(documentRef, text, className = "") {
  const btn = documentRef.createElement("button");
  btn.type = "button";
  btn.className = `r4-tcm-btn ${className}`.trim();
  btn.textContent = text;
  return btn;
}

export function showConfirmModal({ title = "Confirm", message = "Are you sure?", confirmText = "Confirm", cancelText = "Cancel", danger = false, documentRef = globalThis.document } = {}) {
  if (!documentRef?.body) return Promise.resolve(false);
  return new Promise((resolve) => {
    const backdrop = makeBackdrop(documentRef, title, typeof message === "string" ? message : "");
    const actions = backdrop.querySelector(".r4-tcm-modal-actions");
    const cancel = button(documentRef, cancelText);
    const confirm = button(documentRef, confirmText, danger ? "r4-tcm-btn-danger" : "r4-tcm-btn-primary");
    const finish = (value) => { backdrop.remove(); resolve(value); };
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) finish(false); });
    actions.append(cancel, confirm);
  });
}

export function showNumberPrompt({ title = "Enter amount", message = "", initialValue = "", min = 0, documentRef = globalThis.document } = {}) {
  if (!documentRef?.body) return Promise.resolve(null);
  return new Promise((resolve) => {
    const backdrop = makeBackdrop(documentRef, title, message);
    const modal = backdrop.querySelector(".r4-tcm-modal");
    const actions = backdrop.querySelector(".r4-tcm-modal-actions");
    const input = documentRef.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.step = "1";
    input.value = String(initialValue ?? "");
    modal.insertBefore(input, actions);
    const cancel = button(documentRef, "Cancel");
    const confirm = button(documentRef, "Apply", "r4-tcm-btn-primary");
    const finish = (value) => { backdrop.remove(); resolve(value); };
    cancel.addEventListener("click", () => finish(null));
    confirm.addEventListener("click", () => {
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < min) { input.setCustomValidity(`Enter a whole number of at least ${min}.`); input.reportValidity(); return; }
      finish(value);
    });
    actions.append(cancel, confirm);
    input.focus();
    input.select();
  });
}
