import { filterAuditEntries, sanitizeAuditValue } from "../core/audit.js";
import { escapeHtml, formatDateTime } from "./dom.js";
import { showConfirmModal } from "./modals.js";

function option(value, label, selected) {
  return `<option value="${escapeHtml(value)}" ${selected === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function detailsSummary(details) {
  if (!details || typeof details !== "object" || Object.keys(details).length === 0) return "";
  return JSON.stringify(sanitizeAuditValue(details));
}

export function visibleAuditEntries(entries = [], filters = {}) {
  return filterAuditEntries(entries, filters).slice().sort((a, b) => {
    const timeDiff = Number(b?.timestamp || 0) - Number(a?.timestamp || 0);
    if (timeDiff !== 0) return timeDiff;
    return String(b?.id || "").localeCompare(String(a?.id || ""));
  });
}

export function auditLogHtml(entries = [], filters = {}) {
  const type = String(filters.type || "all");
  const phase = String(filters.phase || "all");
  const employee = String(filters.employee || "");
  const visible = visibleAuditEntries(entries, { type, phase, employee });
  const types = [...new Set((entries || []).map(entry => String(entry?.type || "unknown")))].sort();
  const phases = [...new Set((entries || []).map(entry => String(entry?.phase || "unknown")))].sort();
  const rows = visible.map((entry) => `<tr>
      <td>${escapeHtml(formatDateTime(entry.timestamp))}</td>
      <td><strong>${escapeHtml(entry.type)}</strong><br><span class="r4-tcm-muted">${escapeHtml(entry.phase)}</span></td>
      <td>${entry.employeeName ? escapeHtml(entry.employeeName) : "—"}${entry.employeeId != null ? `<br><span class="r4-tcm-muted">[${escapeHtml(entry.employeeId)}]</span>` : ""}</td>
      <td class="r4-tcm-audit-details">${escapeHtml(detailsSummary(entry.details)) || "—"}</td>
    </tr>`).join("");

  return `<div class="r4-tcm-audit-panel">
    <div class="r4-tcm-header">
      <h3 class="r4-tcm-title">Audit Log</h3>
      <button type="button" class="r4-tcm-window-btn" data-audit-action="close" aria-label="Close" title="Close">×</button>
    </div>
    <div class="r4-tcm-audit-filters">
      <label>Action<select data-audit-filter="type">${option("all", "All actions", type)}${types.map(value => option(value, value, type)).join("")}</select></label>
      <label>Result<select data-audit-filter="phase">${option("all", "All results", phase)}${phases.map(value => option(value, value, phase)).join("")}</select></label>
      <label>Employee<input type="search" data-audit-filter="employee" value="${escapeHtml(employee)}" placeholder="Name or ID"></label>
    </div>
    <div class="r4-tcm-actions">
      <button type="button" class="r4-tcm-btn" data-audit-action="copy">Copy Visible Log</button>
      <button type="button" class="r4-tcm-btn" data-audit-action="export">Export JSON</button>
      <button type="button" class="r4-tcm-btn r4-tcm-btn-danger" data-audit-action="clear">Clear Log</button>
      <span class="r4-tcm-muted">${visible.length} of ${(entries || []).length} entries · latest 500 retained</span>
    </div>
    <div class="r4-tcm-table-wrap r4-tcm-audit-table-wrap">
      <table class="r4-tcm-table r4-tcm-audit-table"><thead><tr><th>Time</th><th>Action</th><th>Employee</th><th>Details</th></tr></thead><tbody>${rows || `<tr><td colspan="4">No audit entries match these filters.</td></tr>`}</tbody></table>
    </div>
  </div>`;
}

async function defaultCopy(text, documentRef) {
  const navigatorRef = documentRef?.defaultView?.navigator ?? globalThis.navigator;
  if (navigatorRef?.clipboard?.writeText) {
    await navigatorRef.clipboard.writeText(text);
    return;
  }
  documentRef?.defaultView?.prompt?.("Copy audit log", text);
}

function defaultExport(entries, documentRef) {
  const win = documentRef?.defaultView ?? globalThis.window;
  const BlobImpl = win?.Blob ?? globalThis.Blob;
  const URLImpl = win?.URL ?? globalThis.URL;
  if (!BlobImpl || !URLImpl?.createObjectURL || !documentRef?.createElement) return false;
  const blob = new BlobImpl([JSON.stringify(sanitizeAuditValue(entries), null, 2)], { type: "application/json" });
  const href = URLImpl.createObjectURL(blob);
  const anchor = documentRef.createElement("a");
  anchor.href = href;
  anchor.download = `torn-training-manager-audit-${new Date().toISOString().slice(0, 10)}.json`;
  documentRef.body?.appendChild?.(anchor);
  anchor.click?.();
  anchor.remove?.();
  URLImpl.revokeObjectURL?.(href);
  return true;
}

export function renderAuditLogModal({
  entries = [],
  documentRef = globalThis.document,
  onClear = async () => [],
  copyText = defaultCopy,
  exportJson = defaultExport,
  confirmClear = null
} = {}) {
  if (!documentRef?.body || !documentRef?.createElement) return null;
  const backdrop = documentRef.createElement("div");
  backdrop.className = "r4-tcm-modal-backdrop r4-tcm-audit-backdrop";
  let sourceEntries = Array.isArray(entries) ? entries.slice() : [];
  let filters = { type: "all", phase: "all", employee: "" };

  const close = () => backdrop.remove?.();
  const confirmClearImpl = confirmClear || (() => showConfirmModal({
    title: "Clear Training Manager audit log?",
    message: "This permanently clears the local action log on this browser. Training history and payroll restore records are not affected.",
    confirmText: "Clear Log",
    danger: true,
    documentRef
  }));

  const render = () => {
    backdrop.innerHTML = auditLogHtml(sourceEntries, filters);
    const panel = backdrop.querySelector?.(".r4-tcm-audit-panel");
    panel?.addEventListener?.("click", (event) => event.stopPropagation?.());

    const type = backdrop.querySelector?.('[data-audit-filter="type"]');
    const phase = backdrop.querySelector?.('[data-audit-filter="phase"]');
    const employee = backdrop.querySelector?.('[data-audit-filter="employee"]');
    type?.addEventListener?.("change", () => { filters.type = type.value; render(); });
    phase?.addEventListener?.("change", () => { filters.phase = phase.value; render(); });
    employee?.addEventListener?.("input", () => { filters.employee = employee.value; render(); });

    backdrop.querySelector?.('[data-audit-action="close"]')?.addEventListener?.("click", close);
    backdrop.querySelector?.('[data-audit-action="copy"]')?.addEventListener?.("click", async () => {
      const visible = visibleAuditEntries(sourceEntries, filters);
      await copyText(JSON.stringify(sanitizeAuditValue(visible), null, 2), documentRef);
    });
    backdrop.querySelector?.('[data-audit-action="export"]')?.addEventListener?.("click", () => {
      exportJson(visibleAuditEntries(sourceEntries, filters), documentRef);
    });
    backdrop.querySelector?.('[data-audit-action="clear"]')?.addEventListener?.("click", async () => {
      if (!await confirmClearImpl()) return;
      const result = await onClear();
      sourceEntries = Array.isArray(result) ? result : (Array.isArray(result?.entries) ? result.entries : []);
      render();
    });
  };

  backdrop.addEventListener?.("click", (event) => { if (event.target === backdrop) close(); });
  render();
  documentRef.body.appendChild(backdrop);
  return backdrop;
}
