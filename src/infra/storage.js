import { DEFAULT_SETTINGS, SCHEMA_VERSION } from "../core/constants.js";
import { emptyHistoryState } from "../core/history.js";
import { appendAuditEntry } from "../core/audit.js";
import { emptyPaidState, normalizePaidState } from "../core/paid-contracts.js";
import { emptyFairnessState, normalizeFairnessState } from "../core/fairness.js";
import { emptyOverrideState, normalizeOverrideState } from "../core/overrides.js";

export const STORAGE_KEYS = Object.freeze({
  apiKey: "r4_tcm_api_key",
  settings: "r4_tcm_settings",
  history: "r4_tcm_history",
  payroll: "r4_tcm_payroll",
  cache: "r4_tcm_cache",
  ui: "r4_tcm_ui",
  managerUi: "r4_tcm_manager_ui",
  audit: "r4_tcm_audit",
  trainReceipts: "r4_tcm_train_receipts",
  paidContracts: "r4_tcm_paid_contracts",
  fairness: "r4_tcm_fairness",
  overrides: "r4_tcm_overrides",
  backup: "r4_tcm_last_backup"
});

const DEFAULT_PAYROLL = Object.freeze({ schemaVersion: SCHEMA_VERSION, recordsByEmployeeId: {} });
const DEFAULT_CACHE = Object.freeze({ schemaVersion: SCHEMA_VERSION, employees: [], trains: null, profile: null, lastUpdatedAt: null });
const DEFAULT_UI = Object.freeze({ schemaVersion: SCHEMA_VERSION, x: null, y: null, collapsed: false });
const DEFAULT_MANAGER_UI = Object.freeze({ schemaVersion: SCHEMA_VERSION, x: null, y: null, width: null, height: null, minimized: false, maximized: false });
const DEFAULT_AUDIT = Object.freeze({ schemaVersion: SCHEMA_VERSION, entries: [] });
const DEFAULT_TRAIN_RECEIPTS = Object.freeze({ schemaVersion: SCHEMA_VERSION, receiptsByEmployeeId: {} });
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function defaultSettings() {
  return { schemaVersion: SCHEMA_VERSION, ...DEFAULT_SETTINGS };
}

export class StorageRepo {
  constructor(gm) {
    if (!gm?.getValue || !gm?.setValue || !gm?.deleteValue) throw new TypeError("GM storage adapter is required");
    this.gm = gm;
  }

  async #get(key, fallback) {
    try {
      return await this.gm.getValue(key, clone(fallback));
    } catch {
      return clone(fallback);
    }
  }

  async loadSettings() {
    const raw = await this.#get(STORAGE_KEYS.settings, defaultSettings());
    if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION) return defaultSettings();
    const out = defaultSettings();
    for (const key of SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) out[key] = raw[key];
    }
    return out;
  }

  async saveSettings(settings = {}) {
    const current = await this.loadSettings();
    const out = { ...current, schemaVersion: SCHEMA_VERSION };
    for (const key of SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(settings, key)) out[key] = settings[key];
    }
    await this.gm.setValue(STORAGE_KEYS.settings, clone(out));
    return out;
  }

  async loadHistory() {
    const fallback = emptyHistoryState();
    const raw = await this.#get(STORAGE_KEYS.history, fallback);
    if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION || !isRecord(raw.eventsByNewsId) || !isRecord(raw.unresolvedByNewsId)) return fallback;
    return {
      schemaVersion: SCHEMA_VERSION,
      eventsByNewsId: clone(raw.eventsByNewsId),
      unresolvedByNewsId: clone(raw.unresolvedByNewsId),
      newestTimestamp: Number.isFinite(Number(raw.newestTimestamp)) ? Number(raw.newestTimestamp) : 0
    };
  }

  async saveHistory(state = {}) {
    const out = {
      schemaVersion: SCHEMA_VERSION,
      eventsByNewsId: isRecord(state.eventsByNewsId) ? clone(state.eventsByNewsId) : {},
      unresolvedByNewsId: isRecord(state.unresolvedByNewsId) ? clone(state.unresolvedByNewsId) : {},
      newestTimestamp: Number.isFinite(Number(state.newestTimestamp)) ? Number(state.newestTimestamp) : 0
    };
    await this.gm.setValue(STORAGE_KEYS.history, out);
    return out;
  }

  async loadPayroll() {
    const raw = await this.#get(STORAGE_KEYS.payroll, DEFAULT_PAYROLL);
    if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION || !isRecord(raw.recordsByEmployeeId)) return clone(DEFAULT_PAYROLL);
    return { schemaVersion: SCHEMA_VERSION, recordsByEmployeeId: clone(raw.recordsByEmployeeId) };
  }

  async savePayroll(state = {}) {
    const out = { schemaVersion: SCHEMA_VERSION, recordsByEmployeeId: isRecord(state.recordsByEmployeeId) ? clone(state.recordsByEmployeeId) : {} };
    await this.gm.setValue(STORAGE_KEYS.payroll, out);
    return out;
  }

  async loadCache() {
    const raw = await this.#get(STORAGE_KEYS.cache, DEFAULT_CACHE);
    if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION || !Array.isArray(raw.employees)) return clone(DEFAULT_CACHE);
    return {
      schemaVersion: SCHEMA_VERSION,
      employees: clone(raw.employees),
      trains: raw.trains ?? null,
      profile: isRecord(raw.profile) ? clone(raw.profile) : null,
      lastUpdatedAt: Number.isFinite(Number(raw.lastUpdatedAt)) ? Number(raw.lastUpdatedAt) : null
    };
  }

  async saveCache(state = {}) {
    const out = {
      schemaVersion: SCHEMA_VERSION,
      employees: Array.isArray(state.employees) ? clone(state.employees) : [],
      trains: state.trains ?? null,
      profile: isRecord(state.profile) ? clone(state.profile) : null,
      lastUpdatedAt: Number.isFinite(Number(state.lastUpdatedAt)) ? Number(state.lastUpdatedAt) : null
    };
    await this.gm.setValue(STORAGE_KEYS.cache, out);
    return out;
  }

  async loadUi() {
    const raw = await this.#get(STORAGE_KEYS.ui, DEFAULT_UI);
    if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION) return clone(DEFAULT_UI);
    return {
      schemaVersion: SCHEMA_VERSION,
      x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : null,
      y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : null,
      collapsed: Boolean(raw.collapsed)
    };
  }

  async saveUi(state = {}) {
    const out = {
      schemaVersion: SCHEMA_VERSION,
      x: Number.isFinite(Number(state.x)) ? Number(state.x) : null,
      y: Number.isFinite(Number(state.y)) ? Number(state.y) : null,
      collapsed: Boolean(state.collapsed)
    };
    await this.gm.setValue(STORAGE_KEYS.ui, out);
    return out;
  }

  async loadManagerUi() {
    const raw = await this.#get(STORAGE_KEYS.managerUi, DEFAULT_MANAGER_UI);
    if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION) return clone(DEFAULT_MANAGER_UI);
    return {
      schemaVersion: SCHEMA_VERSION,
      x: finiteNumberOrNull(raw.x),
      y: finiteNumberOrNull(raw.y),
      width: finiteNumberOrNull(raw.width),
      height: finiteNumberOrNull(raw.height),
      minimized: Boolean(raw.minimized),
      maximized: Boolean(raw.maximized)
    };
  }

  async saveManagerUi(state = {}) {
    const out = {
      schemaVersion: SCHEMA_VERSION,
      x: finiteNumberOrNull(state.x),
      y: finiteNumberOrNull(state.y),
      width: finiteNumberOrNull(state.width),
      height: finiteNumberOrNull(state.height),
      minimized: Boolean(state.minimized),
      maximized: Boolean(state.maximized)
    };
    if (out.maximized) out.minimized = false;
    await this.gm.setValue(STORAGE_KEYS.managerUi, out);
    return out;
  }

  async loadAudit() {
    const raw = await this.#get(STORAGE_KEYS.audit, DEFAULT_AUDIT);
    if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION || !Array.isArray(raw.entries)) return clone(DEFAULT_AUDIT);
    return { schemaVersion: SCHEMA_VERSION, entries: clone(raw.entries) };
  }

  async saveAudit(state = {}) {
    const out = { schemaVersion: SCHEMA_VERSION, entries: Array.isArray(state.entries) ? clone(state.entries).slice(-500) : [] };
    await this.gm.setValue(STORAGE_KEYS.audit, out);
    return out;
  }

  async appendAudit(entry) {
    const current = await this.loadAudit();
    const next = appendAuditEntry(current, entry, 500);
    await this.gm.setValue(STORAGE_KEYS.audit, clone(next));
    return next;
  }

  async clearAudit() {
    await this.gm.setValue(STORAGE_KEYS.audit, clone(DEFAULT_AUDIT));
    return clone(DEFAULT_AUDIT);
  }

  async loadTrainReceipts() {
    const raw = await this.#get(STORAGE_KEYS.trainReceipts, DEFAULT_TRAIN_RECEIPTS);
    if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION || !isRecord(raw.receiptsByEmployeeId)) return clone(DEFAULT_TRAIN_RECEIPTS);
    return { schemaVersion: SCHEMA_VERSION, receiptsByEmployeeId: clone(raw.receiptsByEmployeeId) };
  }

  async saveTrainReceipts(state = {}) {
    const out = { schemaVersion: SCHEMA_VERSION, receiptsByEmployeeId: isRecord(state.receiptsByEmployeeId) ? clone(state.receiptsByEmployeeId) : {} };
    await this.gm.setValue(STORAGE_KEYS.trainReceipts, out);
    return out;
  }

  async loadPaidContracts() {
    const raw = await this.#get(STORAGE_KEYS.paidContracts, emptyPaidState());
    if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION) return emptyPaidState();
    return normalizePaidState(raw);
  }

  async savePaidContracts(state = {}) {
    const out = normalizePaidState({ schemaVersion: SCHEMA_VERSION, ...state });
    await this.gm.setValue(STORAGE_KEYS.paidContracts, clone(out));
    return out;
  }

  async loadFairness() {
    const raw = await this.#get(STORAGE_KEYS.fairness, emptyFairnessState(0));
    if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION) return emptyFairnessState(0);
    return normalizeFairnessState(raw);
  }

  async saveFairness(state = {}) {
    const out = normalizeFairnessState({ schemaVersion: SCHEMA_VERSION, ...state });
    await this.gm.setValue(STORAGE_KEYS.fairness, clone(out));
    return out;
  }

  async loadOverrides() {
    const raw = await this.#get(STORAGE_KEYS.overrides, emptyOverrideState());
    if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION) return emptyOverrideState();
    return normalizeOverrideState(raw);
  }

  async saveOverrides(state = {}) {
    const out = normalizeOverrideState({ schemaVersion: SCHEMA_VERSION, ...state });
    await this.gm.setValue(STORAGE_KEYS.overrides, clone(out));
    return out;
  }

  async loadBackup() {
    const raw = await this.#get(STORAGE_KEYS.backup, null);
    return isRecord(raw) ? clone(raw) : null;
  }

  async saveBackup(value) {
    const out = isRecord(value) ? clone(value) : null;
    await this.gm.setValue(STORAGE_KEYS.backup, out);
    return out;
  }

  async getApiKey() {
    const value = await this.#get(STORAGE_KEYS.apiKey, "");
    return typeof value === "string" ? value : "";
  }

  async setApiKey(key) {
    const value = String(key ?? "").trim();
    await this.gm.setValue(STORAGE_KEYS.apiKey, value);
  }

  async clearApiKey() {
    await this.gm.deleteValue(STORAGE_KEYS.apiKey);
  }

  async resetNonKeyData() {
    await Promise.all([
      this.gm.deleteValue(STORAGE_KEYS.settings),
      this.gm.deleteValue(STORAGE_KEYS.history),
      this.gm.deleteValue(STORAGE_KEYS.payroll),
      this.gm.deleteValue(STORAGE_KEYS.cache),
      this.gm.deleteValue(STORAGE_KEYS.ui),
      this.gm.deleteValue(STORAGE_KEYS.managerUi),
      this.gm.deleteValue(STORAGE_KEYS.audit),
      this.gm.deleteValue(STORAGE_KEYS.trainReceipts),
      this.gm.deleteValue(STORAGE_KEYS.paidContracts),
      this.gm.deleteValue(STORAGE_KEYS.fairness),
      this.gm.deleteValue(STORAGE_KEYS.overrides),
      this.gm.deleteValue(STORAGE_KEYS.backup)
    ]);
  }
}
