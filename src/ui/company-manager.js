import { escapeHtml, formatMoney, formatDateTime, formatDuration, byId } from "./dom.js";
import { showConfirmModal, showNumberPrompt } from "./modals.js";

function eligibilityLabel(eligibility, settings) {
  if (!eligibility) return `<span class="r4-tcm-status-warn">UNVERIFIED</span>`;
  if (eligibility.unverified) return `<span class="r4-tcm-status-warn">UNVERIFIED</span>`;
  if (eligibility.eligible) return `<span class="r4-tcm-status-ok">Eligible</span>`;
  const reasons = [];
  if (eligibility.inactive) reasons.push("Inactive");
  if (eligibility.addictionViolation) reasons.push(`Addiction ${escapeHtml(eligibility.reasons.find(r => r.code === "addiction")?.actual ?? "?")} &gt; ${escapeHtml(settings?.maxAddiction ?? "?")}`);
  return `<span class="r4-tcm-status-bad">${reasons.join(" + ") || "Ineligible"}</span>`;
}

function reasonDetails(eligibility, settings) {
  if (!eligibility?.reasons?.length) return "";
  return eligibility.reasons.map((reason) => {
    if (reason.code === "inactive") return `<span class="r4-tcm-reason">Inactive: ${escapeHtml(formatDuration(reason.actual))} &gt; ${escapeHtml(settings?.inactivityDays)}d</span>`;
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

function employeeActions(employee, state, eligibility) {
  const disabledWrite = state.stale || state.status === "refreshing" || state.action?.status === "pending";
  const dock = activeDock(state.payroll, employee.id);
  if (dock && eligibility?.eligible) return `<button class="r4-tcm-btn r4-tcm-btn-primary" data-action="restore" data-id="${employee.id}" ${disabledWrite ? "disabled" : ""}>Restore Pay</button>`;
  if (!eligibility?.eligible && !eligibility?.unverified) return `<button class="r4-tcm-btn r4-tcm-btn-warn" data-action="dock" data-id="${employee.id}" ${disabledWrite ? "disabled" : ""}>Dock Pay</button>`;
  if (eligibility?.eligible) return `<button class="r4-tcm-btn" data-action="train" data-id="${employee.id}" ${(disabledWrite || Number(state.trains) <= 0) ? "disabled" : ""}>Train</button>`;
  return `<span class="r4-tcm-muted">No action</span>`;
}

export function companyManagerHtml(state) {
  const nextId = state.rotation?.nextEmployeeId ?? null;
  const nextEmployee = (state.employees || []).find(e => Number(e.id) === Number(nextId));
  const eligibleCount = state.rotation?.orderedEligible?.length ?? 0;
  const trainDisabled = state.stale || Number(state.trains) <= 0 || !nextEmployee || state.action?.status === "pending";
  const staleBanner = state.stale ? `<div class="r4-tcm-stale">Refresh required. Cached data may be shown; all write actions are disabled.</div>` : "";
  const error = state.error ? `<div class="r4-tcm-error">${escapeHtml(state.error)}</div>` : "";
  const rows = (state.employees || []).map((employee) => {
    const eligibility = byId(state.eligibilityById, employee.id);
    const history = byId(state.trainingById, employee.id) || { totalTrains: 0, lastTrainTimestamp: null };
    const isNext = Number(employee.id) === Number(nextId);
    const dock = activeDock(state.payroll, employee.id);
    let status = eligibilityLabel(eligibility, state.settings) + reasonDetails(eligibility, state.settings);
    if (dock && eligibility?.eligible) status += `<span class="r4-tcm-reason r4-tcm-status-ok">Eligible Again · Pay docked</span>`;
    else if (dock) status += `<span class="r4-tcm-reason r4-tcm-status-warn">Pay docked</span>`;
    if (history.totalTrains === 0) status += `<span class="r4-tcm-reason">Never Trained</span>`;
    if (isNext) status += `<span class="r4-tcm-reason r4-tcm-next">NEXT TRAIN</span>`;
    return `<tr class="${isNext ? "r4-tcm-row-next" : ""}">
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
    <div class="r4-tcm-header"><h3 class="r4-tcm-title">Company Training Manager</h3><span class="r4-tcm-muted">Updated: ${escapeHtml(formatDateTime(state.lastUpdatedAt))}</span></div>
    ${staleBanner}${error}
    <div class="r4-tcm-summary">
      <div class="r4-tcm-summary-card">Available trains: <strong>${escapeHtml(state.trains ?? "?")}</strong></div>
      <div class="r4-tcm-summary-card">Eligible: <strong>${eligibleCount} / ${(state.employees || []).length}</strong></div>
      <div class="r4-tcm-summary-card r4-tcm-next">Next train: <strong>${escapeHtml(nextEmployee?.name || "None")}</strong></div>
    </div>
    <div class="r4-tcm-actions">
      <button class="r4-tcm-btn r4-tcm-btn-primary" data-action="train-next" ${trainDisabled ? "disabled" : ""}>Train Next Eligible${nextEmployee ? ` · ${escapeHtml(nextEmployee.name)}` : ""}</button>
      <button class="r4-tcm-btn" data-action="refresh">Refresh Data</button>
      <button class="r4-tcm-btn" data-action="settings">Settings</button>
    </div>
    <div class="r4-tcm-table-wrap"><table class="r4-tcm-table"><thead><tr><th>Employee</th><th>Eligibility</th><th>Addiction</th><th>Activity</th><th>Last Train</th><th>Pay</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="7">No employees loaded.</td></tr>`}</tbody></table></div>
  </section>`;
}

async function runSafely(fn, actions) {
  try { await fn(); } catch (error) { actions?.onError?.(error); }
}

export function renderCompanyManager(root, state, actions = {}) {
  if (!root) return;
  root.innerHTML = companyManagerHtml(state);
  if (!root.querySelectorAll) return;
  for (const button of root.querySelectorAll("[data-action]")) {
    button.addEventListener?.("click", async () => {
      const action = button.dataset.action;
      const id = Number(button.dataset.id);
      if (action === "refresh") return runSafely(() => actions.refresh?.(), actions);
      if (action === "settings") return actions.openSettings?.();
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
