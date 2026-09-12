function getEligibility(state, id) {
  if (state?.eligibilityById instanceof Map) return state.eligibilityById.get(Number(id));
  return state?.eligibilityById?.[id] ?? state?.eligibilityById?.[String(id)] ?? null;
}

function paidContract(state, id) {
  const contractId = state?.paid?.activeByEmployeeId?.[String(Number(id))];
  return contractId ? state?.paid?.contractsById?.[contractId] || null : null;
}

function badgeFor(state, id) {
  if (Number(state?.recommendation?.nextEmployeeId) === Number(id)) return { label: "NEXT", tone: "next" };
  const paid = paidContract(state, id);
  if (Number(state?.overrides?.priorityOnceEmployeeId) === Number(id)) return { label: "PRIORITY", tone: "priority" };
  if (paid?.status === "auto-paused" || paid?.status === "manually-paused") return { label: "PAUSED", tone: "warn" };
  if (paid) return { label: "PAID", tone: "paid" };
  const eligibility = getEligibility(state, id);
  if (eligibility && eligibility.eligible === false) return { label: eligibility.newHireHold ? "NEW HIRE" : "INELIGIBLE", tone: "bad" };
  return null;
}

function rowEmployeeId(row) {
  const candidates = [row?.dataset?.user, row?.dataset?.userid, row?.dataset?.userId, row?.getAttribute?.("data-user"), row?.getAttribute?.("data-userid")];
  for (const candidate of candidates) {
    const id = Number(candidate);
    if (Number.isInteger(id) && id > 0) return id;
  }
  const link = row?.querySelector?.('a[href*="XID="]');
  if (link?.href) {
    try {
      const id = Number(new URL(link.href, "https://www.torn.com").searchParams.get("XID"));
      if (Number.isInteger(id) && id > 0) return id;
    } catch {}
  }
  return null;
}

export function mountNativeTrainingIndicators({ documentRef = globalThis.document, state = {} } = {}) {
  const existing = documentRef?.querySelectorAll?.(".r4-tcm-native-badge") || [];
  for (const node of existing) node.remove?.();
  if (state?.settings?.showNativeTrainingBadges === false) return;
  const rows = documentRef?.querySelectorAll?.('ul.employee-list li[data-user], li[data-userid], [data-user][class*="employee"], [data-userid][class*="employee"]') || [];
  for (const row of rows) {
    const id = rowEmployeeId(row);
    if (!id) continue;
    const badge = badgeFor(state, id);
    if (!badge) continue;
    if (typeof documentRef?.createElement !== "function") continue;
    const el = documentRef.createElement("span");
    el.className = `r4-tcm-native-badge r4-tcm-native-badge-${badge.tone}`;
    el.textContent = badge.label;
    el.dataset.employeeId = String(id);
    el.title = `Training Manager: ${badge.label}`;
    const name = row.querySelector?.('[class*="name"], .name, a[href*="XID="]');
    if (name?.parentNode?.insertBefore) name.parentNode.insertBefore(el, name.nextSibling);
    else row.appendChild?.(el);
  }
}

export function reminderTextFor(employee = {}, eligibility = {}) {
  const name = employee.name || `Employee ${employee.id ?? ""}`.trim();
  if (eligibility.addictionViolation) {
    const reason = eligibility.reasons?.find?.((item) => item.code === "addiction") || {};
    return `${name}, your addiction is currently ${reason.actual ?? "above the company limit"}${reason.limit != null ? ` (limit ${reason.limit})` : ""}. Please rehab so you can re-enter the company training rotation.`;
  }
  if (eligibility.inactive) return `${name}, you are currently inactive beyond the company limit and are excluded from training. Please become active again to re-enter the training rotation.`;
  if (eligibility.newHireHold) return `${name}, you are still inside the 3-day new-hire training hold and will enter the normal training rotation after the hold completes, provided all other requirements are met.`;
  return `${name}, you are currently not eligible for company training. Please check the company training requirements.`;
}

export const NATIVE_INDICATOR_STYLES = `
.r4-tcm-native-badge{display:inline-flex!important;align-items:center!important;margin-left:6px!important;padding:2px 6px!important;border-radius:999px!important;border:1px solid #555!important;background:#252529!important;color:#ddd!important;font:800 9px/1.2 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif!important;letter-spacing:.04em!important;vertical-align:middle!important}
.r4-tcm-native-badge-next{background:#214d22!important;border-color:#438b4a!important;color:#b7f5b9!important}
.r4-tcm-native-badge-paid{background:#3f3315!important;border-color:#695824!important;color:#efd591!important}
.r4-tcm-native-badge-priority{background:#30284e!important;border-color:#51447b!important;color:#d9d3ff!important}
.r4-tcm-native-badge-warn{background:#493a13!important;border-color:#77601d!important;color:#ffe397!important}
.r4-tcm-native-badge-bad{background:#4b1e22!important;border-color:#79353a!important;color:#ffabab!important}
`;

export function injectNativeIndicatorStyles(documentRef = globalThis.document) {
  if (!documentRef?.head || typeof documentRef?.createElement !== "function" || documentRef.getElementById?.("r4-tcm-native-indicator-styles")) return;
  const style = documentRef.createElement("style");
  style.id = "r4-tcm-native-indicator-styles";
  style.textContent = NATIVE_INDICATOR_STYLES;
  documentRef.head.appendChild?.(style);
}
