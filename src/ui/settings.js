import { escapeHtml } from "./dom.js";
import { showConfirmModal, showNumberPrompt } from "./modals.js";
import { paidSettingsHtml } from "./paid-settings.js";
import { dataRecoveryHtml } from "./data-recovery.js";

const ROTATION_MODES = new Set(["fair", "balanced"]);
const NOTIFICATION_MODES = new Set(["important", "everything", "silent", "custom"]);
const SECTION_IDS = ["general", "training", "paid", "fairness", "notifications", "appearance", "recovery", "advanced"];
const SECTION_LABELS = Object.freeze({
  general: "General",
  training: "Training Rules",
  paid: "Paid Trains",
  fairness: "Fairness",
  notifications: "Notifications",
  appearance: "Appearance",
  recovery: "Data & Recovery",
  advanced: "Advanced"
});

function checked(value) { return value ? "checked" : ""; }
function selected(value, expected) { return value === expected ? "selected" : ""; }

function sectionNav(activeSection) {
  return `<nav class="r4-tcm-settings-nav" aria-label="Training Manager settings">${SECTION_IDS.map((id) => `<button type="button" class="r4-tcm-settings-tab ${activeSection === id ? "is-active" : ""}" data-settings-section="${id}" aria-expanded="${activeSection === id ? "true" : "false"}">${SECTION_LABELS[id]}</button>`).join("")}</nav>`;
}

function generalHtml(settings, hasApiKey) {
  return `<div class="r4-tcm-settings-stack">
    <label>Torn API key<input name="apiKey" type="password" autocomplete="off" value="" placeholder="${hasApiKey ? "Key saved · leave blank to keep it" : "Enter director-capable API key"}"></label>
    <span class="r4-tcm-muted">Stored only in userscript-manager storage and sent only to api.torn.com.</span>
    <label>Refresh interval (minutes)<input name="refreshMinutes" type="number" min="1" step="1" value="${escapeHtml(settings.refreshMinutes ?? 5)}"></label>
    <button type="button" class="r4-tcm-btn r4-tcm-btn-primary" data-settings-action="save">Save General</button>
    <button type="button" class="r4-tcm-btn r4-tcm-btn-warn" data-settings-action="clear-key">Clear API Key</button>
  </div>`;
}

function trainingHtml(settings) {
  return `<div class="r4-tcm-settings-stack">
    <div class="r4-tcm-policy-card"><strong>Inactivity rule</strong><span>More than 24 hours since last action = ineligible.</span></div>
    <div class="r4-tcm-policy-card"><strong>New-hire hold</strong><span>72 hours / 3 days in the company before training eligibility.</span></div>
    <label>Maximum addiction<input name="maxAddiction" type="number" min="0" step="1" value="${escapeHtml(settings.maxAddiction ?? 3)}"></label>
    <label>Removal eligible after <span class="r4-tcm-muted">days, optional</span><input name="removalThresholdDays" type="number" min="0.01" step="0.01" list="r4-tcm-removal-presets" value="${escapeHtml(settings.removalThresholdDays ?? "")}" placeholder="Off"></label>
    <datalist id="r4-tcm-removal-presets"><option value="2">2 days</option><option value="3">3 days</option><option value="7">7 days</option></datalist>
    <label class="r4-tcm-settings-check"><input name="prioritizeNeverTrained" type="checkbox" ${checked(settings.prioritizeNeverTrained !== false)}>Prioritize employees who have never been trained in Fair Rotation</label>
    <button type="button" class="r4-tcm-btn r4-tcm-btn-primary" data-settings-action="save">Save Training Rules</button>
  </div>`;
}

function fairnessHtml(settings) {
  const balanced = settings.rotationMode === "balanced";
  return `<div class="r4-tcm-settings-stack">
    <label>Training mode<select name="rotationMode"><option value="fair" ${selected(settings.rotationMode ?? "fair", "fair")}>Fair Rotation</option><option value="balanced" ${selected(settings.rotationMode, "balanced")}>Balanced Fairness</option></select></label>
    <div class="r4-tcm-settings-help">Fair Rotation stays simple. Balanced Fairness uses verified eligibility-adjusted history without inventing old eligibility.</div>
    <div class="r4-tcm-balanced-options" data-balanced-options data-visible="${balanced ? "true" : "false"}" ${balanced ? "" : "hidden"}>
      <label>Fairness window (days)<input name="fairnessWindowDays" type="number" min="1" step="1" list="r4-tcm-fairness-presets" value="${escapeHtml(settings.fairnessWindowDays ?? 30)}"></label>
      <datalist id="r4-tcm-fairness-presets"><option value="7"><option value="14"><option value="30"><option value="60"><option value="90"></datalist>
      <label class="r4-tcm-settings-check"><input name="accrueDebtWhileIneligible" type="checkbox" ${checked(settings.accrueDebtWhileIneligible === true)}>Accrue fairness debt while ineligible</label>
    </div>
    <button type="button" class="r4-tcm-btn r4-tcm-btn-primary" data-settings-action="save">Save Fairness</button>
  </div>`;
}

function notificationsHtml(settings) {
  const custom = settings.notificationMode === "custom";
  return `<div class="r4-tcm-settings-stack">
    <label>Notification level<select name="notificationMode"><option value="important" ${selected(settings.notificationMode ?? "important", "important")}>Important only</option><option value="everything" ${selected(settings.notificationMode, "everything")}>Everything</option><option value="silent" ${selected(settings.notificationMode, "silent")}>Silent</option><option value="custom" ${selected(settings.notificationMode, "custom")}>Custom</option></select></label>
    <div class="r4-tcm-settings-help">Write-blocking safety reasons are always shown inline, even in Silent mode.</div>
    <div data-custom-notifications data-visible="${custom ? "true" : "false"}" ${custom ? "" : "hidden"} class="r4-tcm-custom-notifications">
      <label class="r4-tcm-settings-check"><input name="notifyCritical" type="checkbox" checked>Critical safety and verification</label>
      <label class="r4-tcm-settings-check"><input name="notifyAction" type="checkbox" checked>Director action required</label>
      <label class="r4-tcm-settings-check"><input name="notifyInfo" type="checkbox">Informational training changes</label>
    </div>
    <button type="button" class="r4-tcm-btn r4-tcm-btn-primary" data-settings-action="save">Save Notifications</button>
  </div>`;
}

function appearanceHtml(settings) {
  return `<div class="r4-tcm-settings-stack">
    <label class="r4-tcm-settings-check"><input name="showNativeTrainingBadges" type="checkbox" ${checked(settings.showNativeTrainingBadges !== false)}>Show compact training badges on Torn employee rows</label>
    <label class="r4-tcm-settings-check"><input name="compactDensity" type="checkbox" ${checked(settings.compactDensity === true)}>Compact density</label>
    <label class="r4-tcm-settings-check"><input name="reduceMotion" type="checkbox" ${checked(settings.reduceMotion === true)}>Reduce Training Manager motion</label>
    <button type="button" class="r4-tcm-btn r4-tcm-btn-primary" data-settings-action="save">Save Appearance</button>
  </div>`;
}

function advancedHtml() {
  return `<div class="r4-tcm-settings-stack">
    <div class="r4-tcm-settings-help">Troubleshooting lives here so normal directors are not greeted by JSON before breakfast.</div>
    <button type="button" class="r4-tcm-btn" data-settings-action="audit-log">Audit Log</button>
    <button type="button" class="r4-tcm-btn" data-settings-action="diagnostics">Diagnostics / Self-Test</button>
  </div>`;
}

function sectionPanel(state, activeSection, hasApiKey) {
  const settings = state.settings || {};
  let body = "";
  if (activeSection === "general") body = generalHtml(settings, hasApiKey);
  if (activeSection === "training") body = trainingHtml(settings);
  if (activeSection === "paid") body = paidSettingsHtml(state);
  if (activeSection === "fairness") body = fairnessHtml(settings);
  if (activeSection === "notifications") body = notificationsHtml(settings);
  if (activeSection === "appearance") body = appearanceHtml(settings);
  if (activeSection === "recovery") body = dataRecoveryHtml();
  if (activeSection === "advanced") body = advancedHtml();
  return `<section class="r4-tcm-settings-panel" data-section-panel="${activeSection}"><h4>${SECTION_LABELS[activeSection]}</h4>${body}</section>`;
}

export function settingsFormHtml(state = {}, { hasApiKey = false, activeSection = "general" } = {}) {
  if (!SECTION_IDS.includes(activeSection)) activeSection = "general";
  return `<div class="r4-tcm-modal r4-tcm-settings">
    <div class="r4-tcm-settings-heading"><div><span class="r4-tcm-eyebrow">VOIDSMITH</span><h3>Training Manager Settings</h3></div><button type="button" class="r4-tcm-window-btn" data-settings-action="close" aria-label="Close settings">×</button></div>
    <div class="r4-tcm-settings-layout">${sectionNav(activeSection)}${sectionPanel(state, activeSection, hasApiKey)}</div>
    <div class="r4-tcm-error" data-settings-error hidden></div>
  </div>`;
}

export function validateSettingsValues(values = {}) {
  const maxAddiction = Number(values.maxAddiction ?? 3);
  const refreshMinutes = Number(values.refreshMinutes ?? 5);
  const rotationMode = values.rotationMode ?? "fair";
  const fairnessWindowDays = Number(values.fairnessWindowDays ?? 30);
  const notificationMode = values.notificationMode ?? "important";
  const rawRemovalThreshold = values.removalThresholdDays;
  const removalThresholdDays = rawRemovalThreshold === null || rawRemovalThreshold === undefined || rawRemovalThreshold === "" ? null : Number(rawRemovalThreshold);

  if (!Number.isInteger(maxAddiction) || maxAddiction < 0) throw new TypeError("Addiction threshold must be a whole number of zero or greater");
  if (!Number.isFinite(refreshMinutes) || refreshMinutes <= 0) throw new TypeError("Refresh minutes must be greater than zero");
  if (!ROTATION_MODES.has(rotationMode)) throw new TypeError("Rotation mode must be fair or balanced");
  if (!Number.isFinite(fairnessWindowDays) || fairnessWindowDays <= 0) throw new TypeError("Fairness window must be greater than zero");
  if (removalThresholdDays !== null && (!Number.isFinite(removalThresholdDays) || removalThresholdDays <= 0)) throw new TypeError("Removal threshold must be a positive number of days or blank");
  if (!NOTIFICATION_MODES.has(notificationMode)) throw new TypeError("Notification mode is invalid");

  return {
    maxAddiction,
    newHireHoldHours: 72,
    prioritizeNeverTrained: values.prioritizeNeverTrained !== false,
    rotationMode,
    fairnessWindowDays,
    accrueDebtWhileIneligible: Boolean(values.accrueDebtWhileIneligible),
    removalThresholdDays,
    notificationMode,
    showNativeTrainingBadges: values.showNativeTrainingBadges !== false,
    compactDensity: Boolean(values.compactDensity),
    reduceMotion: Boolean(values.reduceMotion),
    refreshMinutes
  };
}

export async function savePolicySettings(values, controller) {
  const normalized = validateSettingsValues(values);
  await controller.updateSettings(normalized);
  return normalized;
}

function readValues(modal, current = {}) {
  const read = (name, fallback = undefined) => modal.querySelector?.(`[name="${name}"]`)?.value ?? fallback;
  const bool = (name, fallback = false) => modal.querySelector?.(`[name="${name}"]`)?.checked ?? fallback;
  return {
    ...current,
    maxAddiction: read("maxAddiction", current.maxAddiction ?? 3),
    refreshMinutes: read("refreshMinutes", current.refreshMinutes ?? 5),
    prioritizeNeverTrained: bool("prioritizeNeverTrained", current.prioritizeNeverTrained !== false),
    rotationMode: read("rotationMode", current.rotationMode ?? "fair"),
    fairnessWindowDays: read("fairnessWindowDays", current.fairnessWindowDays ?? 30),
    accrueDebtWhileIneligible: bool("accrueDebtWhileIneligible", current.accrueDebtWhileIneligible === true),
    removalThresholdDays: read("removalThresholdDays", current.removalThresholdDays ?? ""),
    notificationMode: read("notificationMode", current.notificationMode ?? "important"),
    showNativeTrainingBadges: bool("showNativeTrainingBadges", current.showNativeTrainingBadges !== false),
    compactDensity: bool("compactDensity", current.compactDensity === true),
    reduceMotion: bool("reduceMotion", current.reduceMotion === true)
  };
}

function reorderIds(state, employeeId, direction) {
  const queue = [...(state.paid?.queue || [])];
  const contractId = state.paid?.activeByEmployeeId?.[String(Number(employeeId))];
  const index = queue.indexOf(contractId);
  if (index < 0) return queue;
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= queue.length) return queue;
  [queue[index], queue[nextIndex]] = [queue[nextIndex], queue[index]];
  return queue;
}

export async function renderSettingsModal(state, controller, options = {}) {
  const documentRef = options.documentRef ?? globalThis.document;
  if (!documentRef?.body) return null;
  const hasApiKey = Boolean(await controller.getApiKey?.());
  const backdrop = documentRef.createElement("div");
  backdrop.className = "r4-tcm-modal-backdrop";
  let activeSection = "general";
  let localState = { ...state, settings: { ...(state.settings || {}) } };
  const render = () => { backdrop.innerHTML = settingsFormHtml(localState, { hasApiKey, activeSection }); };
  render();
  documentRef.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  const showError = (error) => {
    const errorBox = backdrop.querySelector("[data-settings-error]");
    if (!errorBox) return;
    errorBox.hidden = false;
    errorBox.textContent = String(error?.message || error);
  };

  backdrop.addEventListener("click", async (event) => {
    if (event.target === backdrop) return close();
    const sectionButton = event.target.closest?.("[data-settings-section]");
    if (sectionButton) {
      activeSection = sectionButton.dataset.settingsSection;
      render();
      return;
    }
    const paidButton = event.target.closest?.("[data-paid-action]");
    if (paidButton) {
      const action = paidButton.dataset.paidAction;
      const employeeId = Number(paidButton.dataset.id);
      try {
        if (action === "create") {
          const id = await showNumberPrompt({ title: "Create paid agreement", message: "Employee Torn ID", min: 1, documentRef });
          if (id === null) return;
          const trains = await showNumberPrompt({ title: "Paid trains", message: "How many trains were purchased?", min: 1, documentRef });
          if (trains === null) return;
          const employee = (localState.employees || []).find((row) => Number(row.id) === Number(id));
          await controller.createPaidAgreement?.({ employeeId: Number(id), employeeName: employee?.name || `Employee ${id}`, trainsPurchased: Number(trains) });
        } else if (action === "amend") {
          const trains = await showNumberPrompt({ title: "Add paid trains", message: "Additional trains", min: 1, documentRef });
          if (trains !== null) await controller.amendPaidAgreement?.(employeeId, { addTrains: Number(trains) });
        } else if (action === "pause") await controller.pausePaidAgreement?.(employeeId);
        else if (action === "resume") await controller.resumePaidAgreement?.(employeeId);
        else if (action === "up" || action === "down") await controller.reorderPaidAgreements?.(reorderIds(localState, employeeId, action));
        else if (action === "close") {
          const ok = await showConfirmModal({ title: "Close paid agreement?", message: "This does not move money. Choose the closing outcome in the next step.", confirmText: "Continue", danger: true, documentRef });
          if (ok) await controller.closePaidAgreement?.(employeeId, { outcome: "cancelled", reason: "director_closed" });
        }
        localState = controller.getState?.() ?? localState;
        render();
      } catch (error) { showError(error); }
      return;
    }
    const button = event.target.closest?.("[data-settings-action]");
    if (!button) return;
    const action = button.dataset.settingsAction;
    try {
      if (action === "close") return close();
      if (action === "save") {
        const modal = backdrop.querySelector(".r4-tcm-settings");
        const normalized = await savePolicySettings(readValues(modal, localState.settings), controller);
        localState = { ...(controller.getState?.() ?? localState), settings: normalized };
        const key = modal.querySelector?.('[name="apiKey"]')?.value?.trim?.() || "";
        if (key) await controller.setApiKey?.(key);
        await controller.refresh?.();
        localState = controller.getState?.() ?? localState;
        render();
        return;
      }
      if (action === "rebuild") {
        const ok = await showConfirmModal({ title: "Rebuild training history?", message: "This rescans Company News. Paid agreements and settings are preserved.", confirmText: "Rebuild", documentRef });
        if (ok) await controller.rebuildHistory?.();
        return;
      }
      if (action === "clear-key") {
        const ok = await showConfirmModal({ title: "Clear API key?", message: "The manager will stop refreshing until a new key is provided.", confirmText: "Clear Key", danger: true, documentRef });
        if (ok) await controller.clearApiKey?.();
        return;
      }
      if (action === "reset") {
        const ok = await showConfirmModal({ title: "Reset local Training Manager data?", message: "Training Manager state will be cleared. Your API key is preserved.", confirmText: "Reset Local Data", danger: true, documentRef });
        if (ok) await controller.resetNonKeyData?.();
        return;
      }
      if (action === "audit-log") return options.openAuditLog?.();
      if (action === "diagnostics") return options.openDiagnostics?.();
      if (action === "export-data") return options.exportData?.();
      if (action === "import-data") return options.importData?.();
    } catch (error) { showError(error); }
  });

  backdrop.addEventListener("change", (event) => {
    if (event.target?.name === "rotationMode") {
      localState.settings.rotationMode = event.target.value;
      render();
    }
    if (event.target?.name === "notificationMode") {
      localState.settings.notificationMode = event.target.value;
      render();
    }
  });
  return backdrop;
}
