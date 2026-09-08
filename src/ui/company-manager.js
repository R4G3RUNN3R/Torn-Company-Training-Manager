import { escapeHtml, formatMoney, formatDateTime, formatDuration, byId } from "./dom.js";
import { showConfirmModal, showNumberPrompt } from "./modals.js";

function eligibilityLabel(eligibility, settings) {
  if (!eligibility || eligibility.unverified) return `<span class="r4-tcm-status-warn">UNVERIFIED</span>`;
  if (eligibility.eligible) return `<span class="r4-tcm-status-ok">Eligible</span>`;
  const reasons = [];
  if (eligibility.inactive) reasons.push("Inactive");
  if (eligibility.addictionViolation) reasons.push(`Addiction ${escapeHtml(eligibility.reasons.find(r => r.code === "addiction")?.actual ?? "?")} &gt; ${escapeHtml(settings?.maxAddiction ?? "?")}`);
  return `<span class="r4-tcm-status-bad">${reasons.join(" + ") || "Ineligible"}</span>`;
}

function reasonDetails(eligibility) {
  if (!eligibility?.reasons?.length) return "";
  return eligibility.reasons.map((reason) => {
    if (reason.code === "inactive") return `<span class="r4-tcm-reason">Inactive: ${escapeHtml(formatDuration(reason.actual))} &gt; 24h</span>`;
    if (reason.code === "addiction") return `<span class="r4-tcm-reason">Addiction ${escapeHtml(reason.actual)} &gt; ${escapeHtml(reason.limit)}</span>`;
    if (reason.code === "unverified_activity") return `<span class="r4-tcm-reason">Activity could not be verified</span>`;
    if (reason.code === "unverified_addiction") return `<span class="r4-tcm-reason">Addiction could not be verified</span>`;
    return `<span class="r4-tcm-reason">${escapeHtml(reason.code)}</span>`;
  }).join("");
}

function activeDock(payroll, id) {
  const record = payroll?.recordsByEmployeeId?.[id] ?? payroll?.recordsByEmployeeId?.[String(id)];
  return record && record.dockVerifiedAt && record.restoredAt == null ? record : null;
}

function actionBusy(state) {
  return state.action?.status === "pending" || state.action?.status === "awaiting_verification";
}

function employeeActions(employee, state, eligibility) {
  const disabledWrite = state.stale || state.status === "refreshing" || actionBusy(state);
  const dock = activeDock(state.payroll, employee.id);
  if (dock && eligibility?.eligible) return `<button class="r4-tcm-btn r4-tcm-btn-primary" data-action="restore" data-id="${employee.id}" ${disabledWrite ? "disabled" : ""}>Restore Pay</button>`;
  if (!eligibility?.eligible && !eligibility?.unverified) return `<button class="r4-tcm-btn r4-tcm-btn-warn" data-action="dock" data-id="${employee.id}" ${disabledWrite ? "disabled" : ""}>Dock Pay</button>`;
  if (eligibility?.eligible) return `<button class="r4-tcm-btn" data-action="train" data-id="${employee.id}" ${(disabledWrite || Number(state.trains) <= 0) ? "disabled" : ""}>Train</button>`;
  return `<span class="r4-tcm-muted">No action</span>`;
}

function actionFeedback(state) {
  const action = state?.action;
  if (action?.type !== "train") return "";
  const employee = (state.employees || []).find(item => Number(item.id) === Number(action.employeeId));
  const name = employee?.name || `Employee ${action.employeeId ?? "?"}`;
  if (action.status === "pending") return `<div class="r4-tcm-info">Submitting train for <strong>${escapeHtml(name)}</strong>…</div>`;
  if (action.status === "accepted") return `<div class="r4-tcm-info">Torn accepted the training request for <strong>${escapeHtml(name)}</strong>. Checking Company News…</div>`;
  if (action.status === "awaiting_verification") return `<div class="r4-tcm-info">Train accepted for <strong>${escapeHtml(name)}</strong>. Waiting for Torn's API cache before verification…</div>`;
  if (action.status === "verified") return `<div class="r4-tcm-success">Training verified for <strong>${escapeHtml(name)}</strong>.</div>`;
  if (action.status === "accepted_unverified" || action.status === "unverified") {
    return `<div class="r4-tcm-stale">Torn accepted the train, but Company News has not confirmed it yet. Refresh and verify before retrying.</div>`;
  }
  if (action.status === "rejected") return `<div class="r4-tcm-error">Torn rejected the train: ${escapeHtml(action.reason || "Unknown reason")}</div>`;
  if (action.status === "failed") return `<div class="r4-tcm-error">Train failed: ${escapeHtml(action.reason || "Torn rejected the action")}</div>`;
  return "";
}

function diagnosticsHtml(diagnostics) {
  if (!diagnostics) return "";
  const text = escapeHtml(JSON.stringify(diagnostics, null, 2));
  return `<details class="r4-tcm-diagnostics">
    <summary>Diagnostics / Self-Test</summary>
    <pre class="r4-tcm-diagnostics-pre">${text}</pre>
    <div class="r4-tcm-actions r4-tcm-diagnostics-actions">
      <button type="button" class="r4-tcm-btn" data-action="copy-diagnostics">Copy Diagnostics</button>
    </div>
  </details>`;
}

export function companyManagerHtml(state, { diagnostics = null } = {}) {
  const nextId = state.rotation?.nextEmployeeId ?? null;
  const nextEmployee = (state.employees || []).find(e => Number(e.id) === Number(nextId));
  const eligibleCount = state.rotation?.orderedEligible?.length ?? 0;
  const trainDisabled = state.stale || Number(state.trains) <= 0 || !nextEmployee || actionBusy(state);
  const staleBanner = state.stale ? `<div class="r4-tcm-stale">Refresh required. Cached data may be shown; all write actions are disabled.</div>` : "";
  const error = state.error ? `<div class="r4-tcm-error">${escapeHtml(state.error)}</div>` : "";
  const rows = (state.employees || []).map((employee) => {
    const eligibility = byId(state.eligibilityById, employee.id);
    const history = byId(state.trainingById, employee.id) || { totalTrains: 0, lastTrainTimestamp: null };
    const isNext = Number(employee.id) === Number(nextId);
    const dock = activeDock(state.payroll, employee.id);
    let status = eligibilityLabel(eligibility, state.settings) + reasonDetails(eligibility);
    if (dock && eligibility?.eligible) status += `<span class="r4-tcm-reason r4-tcm-status-ok">Eligible Again · Pay docked</span>`;
    else if (dock) status += `<span class="r4-tcm-reason r4-tcm-status-warn">Pay docked</span>`;
    if (history.totalTrains === 0) status += `<span class="r4-tcm-reason">Never Trained</span>`;
    if (isNext) status += `<span class="r4-tcm-reason r4-tcm-next">NEXT TRAIN</span>`;
    const rowClasses = [isNext ? "r4-tcm-row-next" : "", eligibility?.eligible ? "" : "r4-tcm-row-ineligible"].filter(Boolean).join(" ");
    return `<tr class="${rowClasses}" data-eligible="${eligibility?.eligible ? "true" : "false"}">
      <td><strong>${escapeHtml(employee.name)}</strong><br><span class="r4-tcm-muted">[${escapeHtml(employee.id)}]</span></td>
      <td>${status}</td>
      <td>${escapeHtml(employee.addictionMagnitude ?? "?")} <span class="r4-tcm-muted">(${escapeHtml(employee.rawAddictionEffectiveness ?? "?")})</span></td>
      <td>${escapeHtml(employee.lastActionRelative || formatDuration(eligibility?.inactivitySeconds))}</td>
      <td>${history.totalTrains === 0 ? "Never" : escapeHtml(formatDateTime(history.lastTrainTimestamp))}</td>
      <td>${escapeHtml(formatMoney(employee.wage))}</td>
      <td>${employeeActions(employee, state, eligibility)}</td>
    </tr>`;
  }).join("");

  return `<section class="r4-tcm-manager" data-tcm-state="${escapeHtml(state.status)}">
    <div class="r4-tcm-header" data-manager-drag-handle>
      <h3 class="r4-tcm-title">Company Training Manager</h3>
      <div class="r4-tcm-header-right">
        <span class="r4-tcm-muted">Updated: ${escapeHtml(formatDateTime(state.lastUpdatedAt))}</span>
        <div class="r4-tcm-window-controls">
          <button type="button" class="r4-tcm-window-btn" data-window-action="minimize" aria-label="Minimize" title="Minimize">−</button>
          <button type="button" class="r4-tcm-window-btn" data-window-action="maximize" aria-label="Maximize" title="Maximize">□</button>
          <button type="button" class="r4-tcm-window-btn" data-action="settings" aria-label="Settings" title="Settings">⚙</button>
        </div>
      </div>
    </div>
    <div class="r4-tcm-manager-body">
      ${staleBanner}${error}${actionFeedback(state)}
      <div class="r4-tcm-summary">
        <div class="r4-tcm-summary-card">Available trains: <strong>${escapeHtml(state.trains ?? "?")}</strong></div>
        <div class="r4-tcm-summary-card">Eligible: <strong>${eligibleCount} / ${(state.employees || []).length}</strong></div>
        <div class="r4-tcm-summary-card r4-tcm-next">Next train: <strong>${escapeHtml(nextEmployee?.name || "None")}</strong></div>
      </div>
      <div class="r4-tcm-actions">
        <button class="r4-tcm-btn r4-tcm-btn-primary" data-action="train-next" ${trainDisabled ? "disabled" : ""}>Train Next Eligible${nextEmployee ? ` · ${escapeHtml(nextEmployee.name)}` : ""}</button>
        <button class="r4-tcm-btn" data-action="refresh">Refresh Data</button>
        <button class="r4-tcm-btn" data-action="audit-log">Audit Log</button>
      </div>
      ${diagnosticsHtml(diagnostics)}
      <div class="r4-tcm-table-wrap"><table class="r4-tcm-table"><thead><tr><th>Employee</th><th>Eligibility</th><th>Addiction</th><th>Activity</th><th>Last Train</th><th>Pay</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="7">No employees loaded.</td></tr>`}</tbody></table></div>
    </div>
  </section>`;
}

async function runSafely(fn, actions) { try { await fn(); } catch (error) { actions?.onError?.(error); } }

export function renderCompanyManager(root, state, actions = {}) {
  if (!root) return;
  root.innerHTML = companyManagerHtml(state, { diagnostics: actions.getDiagnostics?.() || null });
  if (!root.querySelectorAll) return;
  for (const button of root.querySelectorAll("[data-action]")) {
    button.addEventListener?.("click", async () => {
      const action = button.dataset.action;
      const id = Number(button.dataset.id);
      if (action === "refresh") return runSafely(() => actions.refresh?.(), actions);
      if (action === "settings") return actions.openSettings?.();
      if (action === "audit-log") return runSafely(() => actions.openAuditLog?.(), actions);
      if (action === "copy-diagnostics") return runSafely(() => actions.copyDiagnostics?.(), actions);
      if (action === "train-next") {
        const nextId = state.rotation?.nextEmployeeId;
        const employee = (state.employees || []).find(e => Number(e.id) === Number(nextId));
        if (!employee) return;
        const ok = await showConfirmModal({ title: `Train ${employee.name}?`, message: `This will spend one company train on <strong>${escapeHtml(employee.name)}</strong>.`, confirmText: "Confirm Train" });
        if (ok) return runSafely(() => actions.trainEmployee?.(employee.id), actions);
      }
      const employee = (state.employees || []).find(e => Number(e.id) === id);
      if (!employee) return;
      if (action === "train") {
        const eligibility = byId(state.eligibilityById, employee.id);
        if (!eligibility?.eligible) return actions?.onError?.(new Error("Employee is not eligible for training"));
        const ok = await showConfirmModal({ title: `Train ${employee.name}?`, message: `Current pay: ${escapeHtml(formatMoney(employee.wage))}. The employee is currently eligible.`, confirmText: "Confirm Train" });
        if (ok) return runSafely(() => actions.trainEmployee?.(id), actions);
      }
      if (action === "dock") {
        const amount = await showNumberPrompt({ title: `Dock pay for ${employee.name}`, message: `Current pay: <strong>${escapeHtml(formatMoney(employee.wage))}</strong><br>Enter the temporary daily pay.`, initialValue: employee.wage, min: 0 });
        if (amount === null) return;
        const ok = await showConfirmModal({ title: "Confirm pay dock", message: `Change ${escapeHtml(employee.name)} from ${escapeHtml(formatMoney(employee.wage))} to <strong>${escapeHtml(formatMoney(amount))}</strong>?`, confirmText: "Apply Dock", danger: true });
        if (ok) return runSafely(() => actions.dockPay?.(id, amount), actions);
      }
      if (action === "restore") {
        const restoreState = actions.getRestoreStateFor?.(id) || { available: true, warning: null };
        if (!restoreState.available) return;
        const warning = restoreState.warning === "current_wage_changed" ? `<br><strong>Warning:</strong> Torn's current wage differs from the wage this script set.` : "";
        const ok = await showConfirmModal({ title: `Restore ${employee.name}'s pay?`, message: `Restore to <strong>${escapeHtml(formatMoney(restoreState.restoreWage))}</strong>?${warning}`, confirmText: "Restore Pay" });
        if (ok) return runSafely(() => actions.restorePay?.(id, { confirmMismatch: restoreState.warning === "current_wage_changed" }), actions);
      }
    });
  }
}

const MANAGER_DEFAULTS = Object.freeze({ x: 16, y: 80, width: 760, height: 560 });
const MANAGER_MIN_WIDTH = 520;
const MANAGER_MIN_HEIGHT = 280;
const MANAGER_MINIMIZED_HEIGHT = 64;
const MANAGER_VIEWPORT_MARGIN = 8;

function finiteOr(value, fallback) { if (value === null || value === undefined || value === "") return fallback; const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function normalizedGeometry(value = {}, windowRef = globalThis.window) {
  const viewportWidth = Math.max(320, finiteOr(windowRef?.innerWidth, 1280));
  const viewportHeight = Math.max(220, finiteOr(windowRef?.innerHeight, 800));
  const maxWidth = Math.max(320, viewportWidth - MANAGER_VIEWPORT_MARGIN * 2);
  const maxHeight = Math.max(220, viewportHeight - MANAGER_VIEWPORT_MARGIN * 2);
  const minWidth = Math.min(MANAGER_MIN_WIDTH, maxWidth);
  const minHeight = Math.min(MANAGER_MIN_HEIGHT, maxHeight);
  const width = clamp(finiteOr(value.width, MANAGER_DEFAULTS.width), minWidth, maxWidth);
  const height = clamp(finiteOr(value.height, MANAGER_DEFAULTS.height), minHeight, maxHeight);
  const x = clamp(finiteOr(value.x, MANAGER_DEFAULTS.x), MANAGER_VIEWPORT_MARGIN, Math.max(MANAGER_VIEWPORT_MARGIN, viewportWidth - width - MANAGER_VIEWPORT_MARGIN));
  const y = clamp(finiteOr(value.y, MANAGER_DEFAULTS.y), MANAGER_VIEWPORT_MARGIN, Math.max(MANAGER_VIEWPORT_MARGIN, viewportHeight - height - MANAGER_VIEWPORT_MARGIN));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

export async function attachManagerWindow({ root, uiStorage, windowRef = globalThis.window, ResizeObserverImpl = globalThis.ResizeObserver } = {}) {
  if (!root) return { destroy() {}, toggleMinimize: async () => {}, toggleMaximize: async () => {}, sync() {} };
  const loaded = await uiStorage?.loadManagerUi?.() || {};
  let geometry = normalizedGeometry(loaded, windowRef);
  let minimized = Boolean(loaded.minimized);
  let maximized = Boolean(loaded.maximized);
  if (maximized) minimized = false;
  let dragging = null;
  let destroyed = false;

  const stateForStorage = () => ({ ...geometry, minimized, maximized });

  const syncControls = () => {
    const minButton = root.querySelector?.('[data-window-action="minimize"]');
    const maxButton = root.querySelector?.('[data-window-action="maximize"]');
    if (minButton) {
      minButton.textContent = minimized ? "▣" : "−";
      minButton.title = minimized ? "Restore" : "Minimize";
      minButton.setAttribute?.("aria-label", minimized ? "Restore" : "Minimize");
    }
    if (maxButton) {
      maxButton.textContent = maximized ? "↙" : "□";
      maxButton.title = maximized ? "Restore" : "Maximize";
      maxButton.setAttribute?.("aria-label", maximized ? "Restore" : "Maximize");
    }
  };

  const apply = () => {
    const viewportWidth = Math.max(320, finiteOr(windowRef?.innerWidth, 1280));
    const viewportHeight = Math.max(220, finiteOr(windowRef?.innerHeight, 800));
    root.classList?.add?.("r4-tcm-floating-shell");
    root.classList?.toggle?.("r4-tcm-minimized", minimized);
    root.classList?.toggle?.("r4-tcm-maximized", maximized);
    root.style.position = "fixed";
    root.style.right = "auto";
    root.style.bottom = "auto";
    if (maximized) {
      root.style.left = `${MANAGER_VIEWPORT_MARGIN}px`;
      root.style.top = `${MANAGER_VIEWPORT_MARGIN}px`;
      root.style.width = `${Math.max(320, viewportWidth - MANAGER_VIEWPORT_MARGIN * 2)}px`;
      root.style.height = `${Math.max(220, viewportHeight - MANAGER_VIEWPORT_MARGIN * 2)}px`;
      root.style.resize = "none";
    } else if (minimized) {
      root.style.left = `${geometry.x}px`;
      root.style.top = `${geometry.y}px`;
      root.style.width = `${geometry.width}px`;
      root.style.height = `${MANAGER_MINIMIZED_HEIGHT}px`;
      root.style.resize = "none";
    } else {
      root.style.left = `${geometry.x}px`;
      root.style.top = `${geometry.y}px`;
      root.style.width = `${geometry.width}px`;
      root.style.height = `${geometry.height}px`;
      root.style.resize = "both";
    }
    syncControls();
  };

  const persist = async () => { if (!destroyed) await uiStorage?.saveManagerUi?.(stateForStorage()); };
  const fromRect = () => {
    const rect = root.getBoundingClientRect?.(); if (!rect) return geometry;
    return normalizedGeometry({ x: finiteOr(root.style.left?.replace?.("px", ""), rect.left), y: finiteOr(root.style.top?.replace?.("px", ""), rect.top), width: rect.width, height: rect.height }, windowRef);
  };

  const toggleMinimize = async () => {
    minimized = !minimized;
    if (minimized) maximized = false;
    apply();
    await persist();
  };
  const toggleMaximize = async () => {
    maximized = !maximized;
    if (maximized) minimized = false;
    apply();
    await persist();
  };

  const onClick = (event) => {
    const control = event?.target?.closest?.("[data-window-action]");
    if (!control) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    if (control.dataset?.windowAction === "minimize") void toggleMinimize();
    if (control.dataset?.windowAction === "maximize") void toggleMaximize();
  };

  const onPointerDown = (event) => {
    if (maximized) return;
    if (!event?.target?.closest?.(".r4-tcm-header")) return;
    if (event.target.closest?.("button,a,input,select,textarea")) return;
    const rect = root.getBoundingClientRect?.(); if (!rect) return;
    dragging = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    root.setPointerCapture?.(event.pointerId); event.preventDefault?.();
  };
  const onPointerMove = (event) => {
    if (!dragging) return;
    geometry = normalizedGeometry({ x: event.clientX - dragging.dx, y: event.clientY - dragging.dy, width: geometry.width, height: geometry.height }, windowRef);
    apply();
  };
  const onPointerUp = (event) => { if (!dragging) return; dragging = null; root.releasePointerCapture?.(event?.pointerId); void persist(); };
  const onViewportResize = () => {
    geometry = normalizedGeometry(geometry, windowRef);
    apply();
    void persist();
  };

  apply();
  root.addEventListener?.("click", onClick);
  root.addEventListener?.("pointerdown", onPointerDown);
  root.addEventListener?.("pointermove", onPointerMove);
  root.addEventListener?.("pointerup", onPointerUp);
  root.addEventListener?.("pointercancel", onPointerUp);
  windowRef?.addEventListener?.("resize", onViewportResize);

  const resizeObserver = ResizeObserverImpl ? new ResizeObserverImpl(() => {
    if (dragging || destroyed || minimized || maximized) return;
    const next = fromRect();
    if (next.x === geometry.x && next.y === geometry.y && next.width === geometry.width && next.height === geometry.height) return;
    geometry = next;
    apply();
    void persist();
  }) : null;
  resizeObserver?.observe?.(root);

  return {
    toggleMinimize,
    toggleMaximize,
    sync: apply,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resizeObserver?.disconnect?.();
      root.removeEventListener?.("click", onClick);
      root.removeEventListener?.("pointerdown", onPointerDown);
      root.removeEventListener?.("pointermove", onPointerMove);
      root.removeEventListener?.("pointerup", onPointerUp);
      root.removeEventListener?.("pointercancel", onPointerUp);
      windowRef?.removeEventListener?.("resize", onViewportResize);
    }
  };
}
