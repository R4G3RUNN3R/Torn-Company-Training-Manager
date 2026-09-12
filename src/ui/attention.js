import { escapeHtml } from "./dom.js";

const ORDER = { critical: 0, action: 1, info: 2 };
const LABEL = { critical: "Critical", action: "Action", info: "Information" };

export function attentionHtml(items = []) {
  const sorted = [...(Array.isArray(items) ? items : [])].sort((a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9));
  const groups = ["critical", "action", "info"].map((severity) => {
    const rows = sorted.filter((item) => item?.severity === severity);
    if (!rows.length) return "";
    return `<section class="r4-tcm-attention-group r4-tcm-attention-${severity}"><h4>${LABEL[severity]}</h4>${rows.map((item) => `<div class="r4-tcm-attention-item">${escapeHtml(item.message || "Training attention item")}</div>`).join("")}</section>`;
  }).join("");
  return `<div class="r4-tcm-modal r4-tcm-attention-panel"><div class="r4-tcm-settings-heading"><div><span class="r4-tcm-eyebrow">TRAINING MANAGER</span><h3>Attention</h3></div><button type="button" class="r4-tcm-window-btn" data-attention-close>×</button></div>${groups || `<div class="r4-tcm-muted">Nothing needs your attention.</div>`}</div>`;
}

export function renderAttentionModal(items, { documentRef = globalThis.document } = {}) {
  if (!documentRef?.createElement || !documentRef?.body) return null;
  const backdrop = documentRef.createElement("div");
  backdrop.className = "r4-tcm-modal-backdrop";
  backdrop.innerHTML = attentionHtml(items);
  documentRef.body.appendChild(backdrop);
  const close = () => backdrop.remove?.();
  backdrop.addEventListener?.("click", (event) => {
    if (event.target === backdrop || event.target.closest?.("[data-attention-close]")) close();
  });
  return backdrop;
}
