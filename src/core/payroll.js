function assertWage(value, label = "wage") {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`);
}

function nowInt(nowSeconds) {
  const n = Number(nowSeconds);
  return Number.isFinite(n) ? Math.trunc(n) : Math.floor(Date.now() / 1000);
}

export function createDockRecord(employee, targetWage, eligibility, nowSeconds = Math.floor(Date.now() / 1000)) {
  assertWage(targetWage, "Target wage");
  if (!employee || !Number.isFinite(Number(employee.id))) throw new TypeError("Employee id is required");
  if (!Number.isInteger(employee.wage) || employee.wage < 0) throw new TypeError("Current wage is required");
  return {
    employeeId: Number(employee.id),
    previousPay: employee.wage,
    requestedDockedPay: targetWage,
    dockedPay: null,
    dockedAt: nowInt(nowSeconds),
    dockVerifiedAt: null,
    reasonsAtDock: Array.isArray(eligibility?.reasons) ? eligibility.reasons.map(r => ({ ...r })) : [],
    restoredAt: null
  };
}

export function markDockVerified(record, currentWage, nowSeconds = Math.floor(Date.now() / 1000)) {
  assertWage(currentWage, "Current wage");
  if (!record) throw new TypeError("Dock record is required");
  if (currentWage !== record.requestedDockedPay) throw new Error("Current wage does not match requested docked wage");
  return {
    ...record,
    dockedPay: currentWage,
    dockVerifiedAt: nowInt(nowSeconds)
  };
}

function employeeEligible(employee) {
  if (typeof employee?.eligible === "boolean") return employee.eligible;
  if (typeof employee?.eligibility?.eligible === "boolean") return employee.eligibility.eligible;
  return false;
}

export function getRestoreState(record, employee) {
  const active = Boolean(record?.dockVerifiedAt) && record?.restoredAt == null && Number.isInteger(record?.dockedPay);
  const eligible = employeeEligible(employee);
  const available = active && eligible;
  let warning = null;
  if (available && Number.isInteger(employee?.wage) && employee.wage !== record.dockedPay) warning = "current_wage_changed";
  return {
    available,
    warning,
    restoreWage: available ? record.previousPay : null
  };
}

export function markRestoreVerified(record, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!record?.dockVerifiedAt || record.restoredAt != null) throw new Error("Dock record is not active");
  return { ...record, restoredAt: nowInt(nowSeconds) };
}
