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

export function employeeMenuHtml(employee, state = {}) {
  const eligibility = getEligibility(state, employee?.id);
  const paid = paidContract(state, employee?.id);
  let actions = "";
  if (eligibility?.eligible) {
    actions += `<button type="button" class="r4-tcm-btn r4-tcm-btn-primary" data-employee-action="train">Train</button>`;
    if (paid) actions += `<button type="button" class="r4-tcm-btn" data-employee-action="bonus">Train as Bonus</button><button type="button" class="r4-tcm-btn" data-employee-action="paid-details">Paid Agreement · ${escapeHtml(paid.trainsRemaining)} left</button>`;
    else actions += `<button type="button" class="r4-tcm-btn" data-employee-action="priority">Priority Once</button><button type="button" class="r4-tcm-btn" data-employee-action="create-paid">Create Paid Agreement</button>`;
    actions += `<button type="button" class="r4-tcm-btn" data-employee-action="skip">Skip / Snooze</button>`;
  } else {
    actions += `<button type="button" class="r4-tcm-btn" data-employee-action="copy-reminder">Copy Reminder</button><button type="button" class="r4-tcm-btn" data-employee-action="profile">Open Profile</button>`;
    if (!eligibility?.unverified) actions += `<button type="button" class="r4-tcm-btn r4-tcm-btn-warn" data-employee-action="dock">Dock Pay</button>`;
  }
  return `<div class="r4-tcm-modal r4-tcm-employee-menu"><div class="r4-tcm-settings-heading"><div><span class="r4-tcm-eyebrow">TRAINING ACTIONS</span><h3>${escapeHtml(employee?.name || `Employee ${employee?.id ?? "?"}`)}</h3></div><button type="button" class="r4-tcm-window-btn" data-employee-action="close">×</button></div><div class="r4-tcm-settings-stack">${actions}<button type="button" class="r4-tcm-link-btn" data-employee-action="details">View Training Details</button></div></div>`;
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
