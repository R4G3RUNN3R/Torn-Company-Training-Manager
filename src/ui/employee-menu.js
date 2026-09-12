import { escapeHtml } from "./dom.js";
import { reminderTextFor } from "./native-indicators.js";

function getEligibility(state, id) {
  if (state?.eligibilityById instanceof Map) return state.eligibilityById.get(Number(id));
  return state?.eligibilityById?.[id] ?? state?.eligibilityById?.[String(id)] ?? null;
}

function paidContract(state, id) {
  const contractId = state?.paid?.activeByEmployeeId?.[String(Number(id))];
  return contractId ? state?.paid?.contractsById?.[contractId] || null : null;
}

function employeeContext(eligibility, paid) {
  if (paid?.status === "auto-paused" || paid?.status === "manually-paused") return `Paid agreement paused · ${paid.trainsRemaining} remaining`;
  if (paid) return `Paid agreement · ${paid.trainsRemaining} remaining`;
  if (eligibility?.eligible) return "Eligible for company training";
  if (eligibility?.newHireHold) return "New-hire training hold";
  if (eligibility?.unverified) return "Eligibility unverified";
  if (eligibility?.inactive && eligibility?.addictionViolation) return "Inactive · addiction policy exceeded";
  if (eligibility?.inactive) return "Inactive · training unavailable";
  if (eligibility?.addictionViolation) return "Addiction policy exceeded";
  return "Training currently unavailable";
}

export function employeeMenuHtml(employee, state = {}) {
  const eligibility = getEligibility(state, employee?.id);
  const paid = paidContract(state, employee?.id);
  let actions = "";
  if (eligibility?.eligible) {
    actions += `<button type="button" class="r4-tcm-btn r4-tcm-btn-primary" data-employee-action="train"><span>Train Employee</span><small>Run fresh safety preflight</small></button>`;
    if (paid) actions += `<button type="button" class="r4-tcm-btn" data-employee-action="bonus"><span>Train as Bonus</span><small>Do not reduce paid balance</small></button><button type="button" class="r4-tcm-btn" data-employee-action="paid-details"><span>Paid Agreement</span><small>${escapeHtml(paid.trainsRemaining)} trains remaining</small></button>`;
    else actions += `<button type="button" class="r4-tcm-btn" data-employee-action="priority"><span>Priority Once</span><small>Move to the front of normal rotation once</small></button><button type="button" class="r4-tcm-btn" data-employee-action="create-paid"><span>Create Paid Agreement</span><small>Add a training commitment</small></button>`;
    actions += `<button type="button" class="r4-tcm-btn" data-employee-action="skip"><span>Skip / Snooze</span><small>Temporarily suppress recommendation</small></button>`;
  } else {
    actions += `<button type="button" class="r4-tcm-btn" data-employee-action="copy-reminder"><span>Copy Reminder</span><small>Prepare a training-policy message</small></button><button type="button" class="r4-tcm-btn" data-employee-action="profile"><span>Open Profile</span><small>Open this player in Torn</small></button>`;
    if (!eligibility?.unverified) actions += `<button type="button" class="r4-tcm-btn r4-tcm-btn-warn" data-employee-action="dock"><span>Dock Pay</span><small>Temporary payroll action · confirmation required</small></button>`;
  }
  return `<div class="r4-tcm-modal r4-tcm-employee-menu r4-tcm-employee-action-sheet">
    <div class="r4-tcm-action-sheet-head">
      <div><span class="r4-tcm-eyebrow">TRAINING ACTIONS</span><h3>${escapeHtml(employee?.name || `Employee ${employee?.id ?? "?"}`)}</h3><p>${escapeHtml(employeeContext(eligibility, paid))}</p></div>
      <button type="button" class="r4-tcm-window-btn" data-employee-action="close" aria-label="Close actions" title="Close">×</button>
    </div>
    <div class="r4-tcm-action-sheet-actions">${actions}</div>
    <div class="r4-tcm-action-sheet-footer"><button type="button" class="r4-tcm-link-btn" data-employee-action="details">View Training Details</button></div>
  </div>`;
}

export function renderEmployeeMenu(employee, state, actions = {}, { documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  if (!documentRef?.createElement || !documentRef?.body) return null;
  const backdrop = documentRef.createElement("div");
  backdrop.className = "r4-tcm-modal-backdrop";
  backdrop.innerHTML = employeeMenuHtml(employee, state);
  documentRef.body.appendChild(backdrop);
  const close = () => backdrop.remove?.();
  backdrop.addEventListener?.("click", async (event) => {
    if (event.target === backdrop) return close();
    const button = event.target.closest?.("[data-employee-action]");
    if (!button) return;
    const action = button.dataset.employeeAction;
    if (action === "close") return close();
    try {
      if (action === "train") { close(); return actions.train?.(employee.id, { countsTowardPaid: Boolean(paidContract(state, employee.id)) }); }
      if (action === "bonus") { close(); return actions.train?.(employee.id, { countsTowardPaid: false }); }
      if (action === "priority") { await actions.priorityOnce?.(employee.id); return close(); }
      if (action === "create-paid") { await actions.createPaid?.(employee); return close(); }
      if (action === "paid-details") { close(); return actions.openPaidSettings?.(); }
      if (action === "skip") { await actions.skip?.(employee.id); return close(); }
      if (action === "copy-reminder") { await actions.copy?.(reminderTextFor(employee, getEligibility(state, employee.id))); return; }
      if (action === "profile") { try { windowRef?.open?.(`https://www.torn.com/profiles.php?XID=${encodeURIComponent(employee.id)}`, "_blank", "noopener"); } catch {} return; }
      if (action === "dock") { close(); return actions.dock?.(employee); }
      if (action === "details") { close(); return actions.details?.(employee.id); }
    } catch (error) { actions.onError?.(error); }
  });
  return backdrop;
}
