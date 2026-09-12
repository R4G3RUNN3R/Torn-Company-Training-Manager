function employeeName(state, id) {
  return (state?.employees || []).find((employee) => Number(employee?.id) === Number(id))?.name || `Employee ${id}`;
}

export function deriveAttentionItems(state = {}) {
  const items = [];
  if (state.stale) items.push({ id: "state-stale", severity: "critical", category: "safety", message: "Company data is stale. Training writes are blocked until refresh succeeds." });
  if (state.status === "error" || state.error) items.push({ id: "state-error", severity: "critical", category: "safety", message: "Training Manager has an API or refresh error." });

  for (const [key, receipt] of Object.entries(state?.trainReceipts?.receiptsByEmployeeId || {})) {
    const id = Number(receipt?.employeeId ?? key);
    items.push({
      id: `receipt-${id}`,
      severity: "critical",
      category: "verification",
      employeeId: id,
      message: `${employeeName(state, id)} has a training result still awaiting verification. Do not retry.`
    });
  }

  for (const contractId of state?.paid?.queue || []) {
    const contract = state?.paid?.contractsById?.[contractId];
    if (!contract) continue;
    if (contract.status === "auto-paused") {
      items.push({
        id: `paid-paused-${contract.employeeId}`,
        severity: "action",
        category: "paid",
        employeeId: Number(contract.employeeId),
        message: `${contract.employeeName || employeeName(state, contract.employeeId)} paid agreement is paused while the employee is ineligible.`
      });
    }
    if (contract.status === "active" && Number(contract.trainsRemaining) === 1) {
      items.push({
        id: `paid-near-complete-${contract.employeeId}`,
        severity: "info",
        category: "paid",
        employeeId: Number(contract.employeeId),
        message: `${contract.employeeName || employeeName(state, contract.employeeId)} has 1 paid train remaining.`
      });
    }
  }

  return items;
}

export function filterAttentionItems(items = [], settings = {}) {
  const safe = Array.isArray(items) ? items.filter(Boolean) : [];
  const mode = settings.notificationMode || "important";
  if (mode === "everything") return safe;
  if (mode === "silent") return [];
  if (mode === "custom") {
    return safe.filter((item) => {
      if (item.severity === "critical") return settings.notifyCritical !== false;
      if (item.severity === "action") return settings.notifyAction === true;
      if (item.severity === "info") return settings.notifyInfo === true;
      return false;
    });
  }
  return safe.filter((item) => item.severity === "critical" || item.severity === "action");
}
