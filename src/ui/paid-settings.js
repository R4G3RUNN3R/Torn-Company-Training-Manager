import { escapeHtml, formatMoney, formatDateTime } from "./dom.js";

function activeContracts(state = {}) {
  const paid = state.paid || {};
  const contracts = paid.contractsById || {};
  return (paid.queue || []).map((id) => contracts[id]).filter(Boolean);
}

export function paidSettingsHtml(state = {}) {
  const contracts = activeContracts(state);
  const rows = contracts.map((contract, index) => `<div class="r4-tcm-paid-setting-row" data-paid-contract="${escapeHtml(contract.id)}">
    <div class="r4-tcm-paid-setting-main">
      <strong>${escapeHtml(contract.employeeName || `Employee ${contract.employeeId}`)}</strong>
      <span>${escapeHtml(contract.trainsDelivered)} / ${escapeHtml(contract.trainsPurchased)} delivered · ${escapeHtml(contract.trainsRemaining)} remaining</span>
      <small>${escapeHtml(contract.status)} · started ${escapeHtml(formatDateTime(contract.startedAt || contract.createdAt))}</small>
    </div>
    <div class="r4-tcm-paid-setting-actions">
      <button type="button" class="r4-tcm-btn" data-paid-action="up" data-id="${escapeHtml(contract.employeeId)}" ${index === 0 ? "disabled" : ""}>↑</button>
      <button type="button" class="r4-tcm-btn" data-paid-action="down" data-id="${escapeHtml(contract.employeeId)}" ${index === contracts.length - 1 ? "disabled" : ""}>↓</button>
      <button type="button" class="r4-tcm-btn" data-paid-action="amend" data-id="${escapeHtml(contract.employeeId)}">Add Trains</button>
      ${contract.status === "manually-paused" ? `<button type="button" class="r4-tcm-btn" data-paid-action="resume" data-id="${escapeHtml(contract.employeeId)}">Resume</button>` : `<button type="button" class="r4-tcm-btn" data-paid-action="pause" data-id="${escapeHtml(contract.employeeId)}">Pause</button>`}
      <button type="button" class="r4-tcm-btn r4-tcm-btn-warn" data-paid-action="close" data-id="${escapeHtml(contract.employeeId)}">Close</button>
    </div>
  </div>`).join("");
  return `<div class="r4-tcm-settings-stack">
    <div class="r4-tcm-settings-help">Paid agreements stay above the normal training queue while eligible. Balances move only after verified trains.</div>
    <button type="button" class="r4-tcm-btn r4-tcm-btn-primary" data-paid-action="create">Create Paid Agreement</button>
    <div class="r4-tcm-paid-settings-list">${rows || `<div class="r4-tcm-muted">No active paid agreements.</div>`}</div>
  </div>`;
}

export function paidAgreementFormHtml({ employee = null, contract = null, mode = "create" } = {}) {
  const employeeId = contract?.employeeId ?? employee?.id ?? "";
  const employeeName = contract?.employeeName ?? employee?.name ?? "";
  const isAmend = mode === "amend";
  return `<div class="r4-tcm-paid-form">
    <h3>${isAmend ? "Add Paid Trains" : "Paid Train Agreement"}</h3>
    ${isAmend ? `<p><strong>${escapeHtml(employeeName || `Employee ${employeeId}`)}</strong> · ${escapeHtml(contract?.trainsRemaining ?? 0)} remaining</p>` : `<label>Employee ID<input name="employeeId" type="number" min="1" step="1" value="${escapeHtml(employeeId)}"></label><label>Employee name<input name="employeeName" type="text" value="${escapeHtml(employeeName)}"></label>`}
    <label>${isAmend ? "Additional trains" : "Trains purchased"}<input name="trainsPurchased" type="number" min="1" step="1" value=""></label>
    <label>Price per train <span class="r4-tcm-muted">optional</span><input name="pricePerTrain" type="number" min="0" step="1" value="${escapeHtml(contract?.pricePerTrain ?? "")}"></label>
    <label>Total paid <span class="r4-tcm-muted">optional</span><input name="totalPaid" type="number" min="0" step="1" value="${escapeHtml(contract?.totalPaid ?? "")}"></label>
    <label>Reference / note <span class="r4-tcm-muted">optional</span><input name="note" type="text" value="${escapeHtml(contract?.note ?? "")}"></label>
  </div>`;
}

export function paidContractSummary(contract) {
  if (!contract) return "No paid agreement";
  const monetary = contract.totalPaid != null ? ` · ${formatMoney(contract.totalPaid)}` : "";
  return `${contract.trainsRemaining} remaining${monetary}`;
}
