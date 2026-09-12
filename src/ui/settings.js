import { escapeHtml } from "./dom.js";
import { showConfirmModal } from "./modals.js";

const ROTATION_MODES = new Set(["fair", "balanced"]);
const NOTIFICATION_MODES = new Set(["important", "everything", "silent", "custom"]);

function checked(value) { return value ? "checked" : ""; }

export function settingsFormHtml(state = {}, { hasApiKey = false } = {}) {
  const settings = state.settings || {};
  return `<div class="r4-tcm-modal r4-tcm-settings">
    <h3>Training Manager Settings</h3>
    <div class="r4-tcm-settings-row"><label>Inactivity rule</label><span class="r4-tcm-muted">More than 24 hours since last action = ineligible for training.</span></div>
    <div class="r4-tcm-settings-row"><label>New-hire training hold</label><span class="r4-tcm-muted">Employees must be in the company for at least 72 hours (3 days) before they can be trained.</span></div>
    <div class="r4-tcm-settings-row"><label>Maximum addiction</label><input name="maxAddiction" type="number" min="0" step="1" value="${escapeHtml(settings.maxAddiction ?? 3)}"></div>
    <div class="r4-tcm-settings-row"><label>Refresh interval (minutes)</label><input name="refreshMinutes" type="number" min="1" step="1" value="${escapeHtml(settings.refreshMinutes ?? 5)}"></div>
    <div class="r4-tcm-settings-row r4-tcm-settings-check"><input name="prioritizeNeverTrained" type="checkbox" ${checked(settings.prioritizeNeverTrained !== false)}><label>Prioritize employees who have never been trained</label></div>
    <div class="r4-tcm-settings-row r4-tcm-settings-check"><input name="showGlobalBadge" type="checkbox" ${checked(settings.showGlobalBadge !== false)}><label>Show global next-train badge</label></div>
    <div class="r4-tcm-settings-row r4-tcm-settings-check"><input name="showTrainCount" type="checkbox" ${checked(settings.showTrainCount !== false)}><label>Show available train count</label></div>
    <hr>
    <div class="r4-tcm-settings-row"><label>Torn API key</label><input name="apiKey" type="password" autocomplete="off" value="" placeholder="${hasApiKey ? "Key saved · leave blank to keep it" : "Enter director-capable API key"}"><span class="r4-tcm-muted">Stored only in userscript-manager storage and sent only to api.torn.com.</span></div>
    <div class="r4-tcm-error" data-settings-error hidden></div>
    <div class="r4-tcm-actions">
      <button type="button" class="r4-tcm-btn r4-tcm-btn-primary" data-settings-action="save">Save</button>
      <button type="button" class="r4-tcm-btn" data-settings-action="rebuild">Rebuild Training History</button>
      <button type="button" class="r4-tcm-btn r4-tcm-btn-warn" data-settings-action="clear-key">Clear API Key</button>
      <button type="button" class="r4-tcm-btn r4-tcm-btn-danger" data-settings-action="reset">Reset Local Data</button>
      <button type="button" class="r4-tcm-btn" data-settings-action="close">Close</button>
    </div>
  </div>`;
}

export function validateSettingsValues(values = {}) {
  const maxAddiction = Number(values.maxAddiction);
  const refreshMinutes = Number(values.refreshMinutes ?? 5);
  const rotationMode = values.rotationMode ?? "fair";
  const fairnessWindowDays = Number(values.fairnessWindowDays ?? 30);
  const notificationMode = values.notificationMode ?? "important";
  const rawRemovalThreshold = values.removalThresholdDays;
  const removalThresholdDays = rawRemovalThreshold === null || rawRemovalThreshold === undefined || rawRemovalThreshold === ""
    ? null
    : Number(rawRemovalThreshold);

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
    showGlobalBadge: values.showGlobalBadge !== false,
    showTrainCount: values.showTrainCount !== false,
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

export async function renderSettingsModal(state, controller, { documentRef = globalThis.document } = {}) {
  if (!documentRef?.body) return null;
  const hasApiKey = Boolean(await controller.getApiKey?.());
  const backdrop = documentRef.createElement("div");
  backdrop.className = "r4-tcm-modal-backdrop";
  backdrop.innerHTML = settingsFormHtml(state, { hasApiKey });
  documentRef.body.appendChild(backdrop);
  const modal = backdrop.querySelector(".r4-tcm-settings");
  const errorBox = backdrop.querySelector("[data-settings-error]");
  const close = () => backdrop.remove();
  const showError = (error) => {
    if (!errorBox) return;
    errorBox.hidden = false;
    errorBox.textContent = String(error?.message || error);
  };

  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
  for (const button of backdrop.querySelectorAll("[data-settings-action]")) {
    button.addEventListener("click", async () => {
      const action = button.dataset.settingsAction;
      try {
        if (action === "close") return close();
        if (action === "save") {
          const maxAddiction = modal.querySelector('[name="maxAddiction"]').value;
          const refreshMinutes = modal.querySelector('[name="refreshMinutes"]').value;
          const prioritizeNeverTrained = modal.querySelector('[name="prioritizeNeverTrained"]').checked;
          const showGlobalBadge = modal.querySelector('[name="showGlobalBadge"]').checked;
          const showTrainCount = modal.querySelector('[name="showTrainCount"]').checked;
          await savePolicySettings({
            ...state.settings,
            maxAddiction,
            refreshMinutes,
            prioritizeNeverTrained,
            showGlobalBadge,
            showTrainCount
          }, controller);
          const key = modal.querySelector('[name="apiKey"]').value.trim();
          if (key) await controller.setApiKey?.(key);
          await controller.refresh?.();
          close();
          return;
        }
        if (action === "rebuild") {
          const ok = await showConfirmModal({ title: "Rebuild training history?", message: "This will rescan Company News. Payroll records and settings are preserved.", confirmText: "Rebuild", documentRef });
          if (ok) await controller.rebuildHistory?.();
          return;
        }
        if (action === "clear-key") {
          const ok = await showConfirmModal({ title: "Clear API key?", message: "The manager will stop refreshing until a new key is provided.", confirmText: "Clear Key", danger: true, documentRef });
          if (ok) { await controller.clearApiKey?.(); close(); }
          return;
        }
        if (action === "reset") {
          const ok = await showConfirmModal({ title: "Reset local Training Manager data?", message: "Settings, history cache, payroll audit records and UI position will be cleared. Your API key is preserved.", confirmText: "Reset Local Data", danger: true, documentRef });
          if (ok) { await controller.resetNonKeyData?.(); close(); }
        }
      } catch (error) { showError(error); }
    });
  }
  return backdrop;
}
