import { evaluateEligibility } from "../core/eligibility.js";
import { emptyHistoryState, mergeTrainingNews, summarizeTrainingHistory } from "../core/history.js";
import { rankTrainingCandidates } from "../core/rotation.js";
import { createDockRecord, markDockVerified, getRestoreState, markRestoreVerified } from "../core/payroll.js";
import { createAuditEntry, sanitizeAuditValue } from "../core/audit.js";

const emptyRotation = () => ({ orderedEligible: [], skipped: [], nextEmployeeId: null, reasonById: new Map() });
const TRAIN_CACHE_WAIT_MS = 31_000;
const EMPTY_AUDIT = Object.freeze({ schemaVersion: 1, entries: [] });

function employeeMap(employees) {
  return new Map((employees || []).map((employee) => [Number(employee.id), employee]));
}

function wagesMap(employees) {
  return new Map((employees || []).filter(e => Number.isInteger(e.wage)).map(e => [Number(e.id), e.wage]));
}

function validSettingsPatch(patch) {
  if (Object.prototype.hasOwnProperty.call(patch, "inactivityDays")) {
    if (!Number.isFinite(Number(patch.inactivityDays)) || Number(patch.inactivityDays) < 0) return false;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "maxAddiction")) {
    if (!Number.isInteger(Number(patch.maxAddiction)) || Number(patch.maxAddiction) < 0) return false;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "refreshMinutes")) {
    if (!Number.isFinite(Number(patch.refreshMinutes)) || Number(patch.refreshMinutes) <= 0) return false;
  }
  return true;
}

function hasNewTrainingEvent(history, beforeIds, employeeId) {
  return Object.entries(history?.eventsByNewsId || {}).some(([newsId, event]) => !beforeIds.has(newsId) && Number(event?.employeeId) === Number(employeeId));
}

function activeDockCount(payroll) {
  return Object.values(payroll?.recordsByEmployeeId || {}).filter((record) => record?.dockVerifiedAt && record?.restoredAt == null).length;
}

function changedSettingKeys(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter((key) => key !== "schemaVersion" && JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
}

export class TrainingManagerController {
  constructor({ api, storage, pageActions, sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)), nowSeconds = () => Math.floor(Date.now() / 1000) }) {
    if (!api || !storage || !pageActions) throw new TypeError("api, storage and pageActions are required");
    this.api = api;
    this.storage = storage;
    this.pageActions = pageActions;
    this.sleep = sleep;
    this.nowSeconds = nowSeconds;
    this.listeners = new Set();
    this.refreshPromise = null;
    this.actionLocks = new Set();
    this.unverifiedTrainIds = new Set();
    this.state = {
      status: "idle",
      stale: true,
      lastUpdatedAt: null,
      employees: [],
      eligibilityById: new Map(),
      trainingById: new Map(),
      rotation: emptyRotation(),
      trains: null,
      profile: null,
      history: emptyHistoryState(),
      payroll: { schemaVersion: 1, recordsByEmployeeId: {} },
      audit: { ...EMPTY_AUDIT, entries: [] },
      auditError: null,
      settings: null,
      action: null,
      error: null
    };
  }

  getState() { return this.state; }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit(patch = {}) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      try { listener(this.state); } catch { }
    }
  }

  #recompute(extra = {}) {
    const employees = extra.employees ?? this.state.employees;
    const history = extra.history ?? this.state.history;
    const settings = extra.settings ?? this.state.settings;
    const eligibilityById = new Map();
    if (settings) {
      for (const employee of employees) eligibilityById.set(Number(employee.id), evaluateEligibility(employee, settings, this.nowSeconds()));
    }
    const trainingById = summarizeTrainingHistory(history, employees);
    const rotation = settings
      ? rankTrainingCandidates({ employees, eligibilityById, trainingById, settings })
      : emptyRotation();
    this.#emit({ employees, history, settings, eligibilityById, trainingById, rotation, ...extra });
  }

  async #audit(type, phase, { employee = null, employeeId = null, employeeName = null, details = {} } = {}) {
    if (typeof this.storage.appendAudit !== "function") return null;
    const resolvedId = Number.isInteger(Number(employee?.id)) ? Number(employee.id) : (Number.isInteger(Number(employeeId)) ? Number(employeeId) : null);
    const resolvedName = employee?.name ?? employeeName ?? null;
    const entry = createAuditEntry({ type, phase, employeeId: resolvedId, employeeName: resolvedName, details }, this.nowSeconds());
    try {
      const audit = await this.storage.appendAudit(entry);
      this.#emit({ audit, auditError: null });
      return entry;
    } catch (error) {
      this.#emit({ auditError: String(error?.message || "Audit storage failed") });
      return null;
    }
  }

  async initialize() {
    const [settings, history, payroll, cache, audit] = await Promise.all([
      this.storage.loadSettings(),
      this.storage.loadHistory(),
      this.storage.loadPayroll(),
      this.storage.loadCache(),
      typeof this.storage.loadAudit === "function" ? this.storage.loadAudit() : Promise.resolve({ ...EMPTY_AUDIT, entries: [] })
    ]);
    this.state = {
      ...this.state,
      settings,
      history,
      payroll,
      audit,
      employees: Array.isArray(cache.employees) ? cache.employees : [],
      trains: cache.trains ?? null,
      profile: cache.profile ?? null,
      lastUpdatedAt: cache.lastUpdatedAt ?? null,
      stale: true,
      status: "loading"
    };
    this.#recompute();
    await this.refresh();
    return this.state;
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.#refreshInternal().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async #refreshInternal() {
    this.#emit({ status: "refreshing", error: null });
    try {
      const [employees, profile] = await Promise.all([this.api.getEmployees(), this.api.getProfile()]);
      const capabilityMissing = [];
      if (!Number.isFinite(Number(profile?.trains))) capabilityMissing.push("profile.trains");
      if (employees.length > 0) {
        const sample = employees[0];
        if (!Number.isInteger(sample?.wage) || sample.wage < 0) capabilityMissing.push("employees.wage");
        if (!Number.isFinite(Number(sample?.joinedAt))) capabilityMissing.push("employees.joined_at");
        if (!Number.isFinite(Number(sample?.rawAddictionEffectiveness))) capabilityMissing.push("employees.effectiveness.addiction");
        if (!Number.isFinite(Number(sample?.lastActionTimestamp))) capabilityMissing.push("employees.last_action.timestamp");
      }
      if (capabilityMissing.length) throw new Error(`Director API capability validation failed: ${capabilityMissing.join(", ")}`);
      const newsResult = await this.api.getTrainingNewsSince(this.state.history?.newestTimestamp || 0);
      const history = mergeTrainingNews(this.state.history, newsResult?.news || []);
      await this.storage.saveHistory(history);
      const trains = Number.isFinite(Number(profile?.trains)) ? Number(profile.trains) : null;
      const lastUpdatedAt = this.nowSeconds();
      await this.storage.saveCache({ employees, trains, profile, lastUpdatedAt });
      this.unverifiedTrainIds.clear();
      this.#recompute({
        employees,
        profile,
        trains,
        history,
        stale: false,
        lastUpdatedAt,
        status: newsResult?.complete === false ? "partial" : "ready",
        error: newsResult?.complete === false ? `Training news sync incomplete: ${newsResult.reason || "unknown"}` : null,
        action: null
      });
    } catch (error) {
      const reason = String(error?.message || "Unable to refresh Torn data");
      this.#emit({ status: "error", stale: true, error: reason, action: null });
      await this.#audit("refresh", "failed", { details: { reason } });
    }
    return this.state;
  }

  async rebuildHistory() {
    if (this.state.stale) throw new Error("Cannot rebuild history while current data is stale");
    this.#emit({ status: "rebuilding_history", action: { type: "history", status: "pending" } });
    try {
      const result = await this.api.rebuildTrainingNews();
      const history = mergeTrainingNews(emptyHistoryState(), result.news || []);
      await this.storage.saveHistory(history);
      const phase = result.complete ? "completed" : "incomplete";
      this.#recompute({ history, status: result.complete ? "ready" : "partial", action: { type: "history", status: result.complete ? "verified" : "incomplete" } });
      await this.#audit("history", phase, { details: { complete: Boolean(result.complete), reason: result.reason || null, eventCount: Object.keys(history.eventsByNewsId || {}).length } });
      return { status: result.complete ? "verified" : "incomplete", reason: result.reason || null };
    } catch (error) {
      const reason = String(error?.message || error);
      await this.#audit("history", "failed", { details: { reason } });
      throw error;
    }
  }

  #assertFresh() {
    if (this.state.stale) throw new Error("Current company data is stale; refresh before making changes");
  }

  #employee(id) {
    return employeeMap(this.state.employees).get(Number(id)) || null;
  }

  #eligibility(id) {
    return this.state.eligibilityById.get(Number(id)) || null;
  }

  async #readTrainingNews(history, { cacheBust = null } = {}) {
    const result = await this.api.getTrainingNewsSince(history?.newestTimestamp || 0, cacheBust == null ? {} : { cacheBust });
    return mergeTrainingNews(history, result?.news || []);
  }

  async trainEmployee(id) {
    id = Number(id);
    this.#assertFresh();
    if (this.unverifiedTrainIds.has(id)) throw new Error("Previous train attempt is awaiting verification; refresh before retrying");
    if (this.actionLocks.has(id)) throw new Error("An action is already pending for this employee");
    const employee = this.#employee(id);
    const eligibility = this.#eligibility(id);
    if (!employee) throw new Error("Employee not found");
    if (!eligibility?.eligible) throw new Error("Employee is not eligible for training");
    if (!Number.isFinite(Number(this.state.trains)) || Number(this.state.trains) <= 0) throw new Error("No company trains are available");

    await this.#audit("train", "requested", {
      employee,
      details: { trainsBefore: this.state.trains, eligibilityReasons: (eligibility.reasons || []).map(r => r.code) }
    });
    this.actionLocks.add(id);
    this.#emit({ action: { type: "train", employeeId: id, status: "pending" } });
    try {
      const beforeIds = new Set(Object.keys(this.state.history.eventsByNewsId || {}));
      const submitted = await this.pageActions.submitTrain(id);
      if (submitted?.status === "rejected") {
        const reason = submitted?.reason || "Torn rejected the training request";
        this.#emit({ action: { type: "train", employeeId: id, status: "rejected", reason } });
        await this.#audit("train", "rejected", { employee, details: { reason, trainsBefore: this.state.trains } });
        return { status: "rejected", reason };
      }
      if (submitted?.status !== "accepted") {
        const reason = submitted?.reason || submitted?.status || "Training request failed";
        this.#emit({ action: { type: "train", employeeId: id, status: "failed", reason } });
        await this.#audit("train", "failed", { employee, details: { reason, trainsBefore: this.state.trains } });
        return { status: "failed", reason };
      }

      this.#emit({ action: { type: "train", employeeId: id, status: "accepted" } });
      await this.#audit("train", "accepted", { employee, details: { trainsBefore: this.state.trains } });
      let workingHistory = await this.#readTrainingNews(this.state.history);
      if (hasNewTrainingEvent(workingHistory, beforeIds, id)) {
        await this.storage.saveHistory(workingHistory);
        this.#recompute({ history: workingHistory });
        await this.refresh();
        this.#emit({ action: { type: "train", employeeId: id, status: "verified" } });
        await this.#audit("train", "verified", { employee, details: { trainsAfter: this.state.trains } });
        return { status: "verified" };
      }

      this.#recompute({
        history: workingHistory,
        action: { type: "train", employeeId: id, status: "awaiting_verification", retryAfterSeconds: 31 }
      });
      await this.#audit("train", "awaiting_verification", { employee, details: { retryAfterSeconds: 31 } });
      await this.sleep(TRAIN_CACHE_WAIT_MS);

      workingHistory = await this.#readTrainingNews(workingHistory, { cacheBust: this.nowSeconds() });
      await this.storage.saveHistory(workingHistory);
      if (!hasNewTrainingEvent(workingHistory, beforeIds, id)) {
        this.unverifiedTrainIds.add(id);
        const reason = "Torn accepted the request, but company news has not confirmed it yet. Refresh and verify before retrying.";
        this.#recompute({
          history: workingHistory,
          action: { type: "train", employeeId: id, status: "accepted_unverified", reason }
        });
        await this.#audit("train", "accepted_unverified", { employee, details: { reason } });
        return { status: "accepted_unverified" };
      }

      this.#recompute({ history: workingHistory });
      await this.refresh();
      this.#emit({ action: { type: "train", employeeId: id, status: "verified" } });
      await this.#audit("train", "verified", { employee, details: { trainsAfter: this.state.trains } });
      return { status: "verified" };
    } catch (error) {
      const reason = String(error?.message || error);
      this.#emit({ action: { type: "train", employeeId: id, status: "failed", reason } });
      await this.#audit("train", "failed", { employee, details: { reason } });
      throw error;
    } finally {
      this.actionLocks.delete(id);
    }
  }

  async #pollWage(employeeId, targetWage) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await this.sleep(1500);
      const employees = await this.api.getEmployees({ cacheBust: this.nowSeconds() });
      const target = employeeMap(employees).get(Number(employeeId));
      if (target?.wage === targetWage) return { verified: true, employees, employee: target };
    }
    return { verified: false };
  }

  async dockPay(id, targetWage) {
    id = Number(id);
    this.#assertFresh();
    if (this.actionLocks.has(id)) throw new Error("An action is already pending for this employee");
    const employee = this.#employee(id);
    const eligibility = this.#eligibility(id);
    if (!employee) throw new Error("Employee not found");
    if (eligibility?.eligible) throw new Error("Eligible employees cannot have pay docked by this policy tool");
    if (eligibility?.unverified) throw new Error("Eligibility is unverified; pay docking is disabled");
    const record = createDockRecord(employee, targetWage, eligibility, this.nowSeconds());

    await this.#audit("dock", "requested", { employee, details: { previousWage: employee.wage, requestedWage: targetWage, eligibilityReasons: (eligibility.reasons || []).map(r => r.code) } });
    this.actionLocks.add(id);
    this.#emit({ action: { type: "dock", employeeId: id, status: "pending" } });
    try {
      const submitted = await this.pageActions.submitWageChange({ employeeId: id, targetWage, apiWagesById: wagesMap(this.state.employees) });
      if (submitted?.status !== "submitted") {
        const reason = submitted?.reason || submitted?.status || "Pay dock submission failed";
        this.#emit({ action: { type: "dock", employeeId: id, status: "failed", reason } });
        await this.#audit("dock", "failed", { employee, details: { reason, requestedWage: targetWage } });
        return { status: "failed", reason };
      }
      const poll = await this.#pollWage(id, targetWage);
      if (!poll.verified) {
        this.#emit({ stale: true, action: { type: "dock", employeeId: id, status: "unverified" } });
        await this.#audit("dock", "unverified", { employee, details: { requestedWage: targetWage } });
        return { status: "unverified" };
      }
      const verifiedRecord = markDockVerified(record, targetWage, this.nowSeconds());
      const payroll = {
        ...this.state.payroll,
        recordsByEmployeeId: { ...(this.state.payroll.recordsByEmployeeId || {}), [id]: verifiedRecord }
      };
      await this.storage.savePayroll(payroll);
      this.#emit({ payroll });
      await this.refresh();
      this.#emit({ action: { type: "dock", employeeId: id, status: "verified" } });
      await this.#audit("dock", "verified", { employee, details: { previousWage: employee.wage, dockedWage: targetWage } });
      return { status: "verified", record: verifiedRecord };
    } catch (error) {
      const reason = String(error?.message || error);
      this.#emit({ action: { type: "dock", employeeId: id, status: "failed", reason } });
      await this.#audit("dock", "failed", { employee, details: { reason, requestedWage: targetWage } });
      throw error;
    } finally {
      this.actionLocks.delete(id);
    }
  }

  getRestoreStateFor(id) {
    id = Number(id);
    const record = this.state.payroll?.recordsByEmployeeId?.[id] ?? this.state.payroll?.recordsByEmployeeId?.[String(id)];
    const employee = this.#employee(id);
    const eligibility = this.#eligibility(id);
    if (!record || !employee) return { available: false, warning: null, restoreWage: null };
    return getRestoreState(record, { ...employee, eligibility });
  }

  async restorePay(id, { confirmMismatch = false } = {}) {
    id = Number(id);
    this.#assertFresh();
    if (this.actionLocks.has(id)) throw new Error("An action is already pending for this employee");
    const record = this.state.payroll?.recordsByEmployeeId?.[id] ?? this.state.payroll?.recordsByEmployeeId?.[String(id)];
    const employee = this.#employee(id);
    if (!record || !employee) throw new Error("No active dock record exists for this employee");
    const restoreState = this.getRestoreStateFor(id);
    if (!restoreState.available) throw new Error("Employee is not yet eligible for pay restoration");
    if (restoreState.warning === "current_wage_changed" && !confirmMismatch) throw new Error("Current wage changed; explicit mismatch confirmation is required");

    const targetWage = restoreState.restoreWage;
    await this.#audit("restore", "requested", { employee, details: { currentWage: employee.wage, restoreWage: targetWage, mismatchConfirmed: Boolean(confirmMismatch) } });
    this.actionLocks.add(id);
    this.#emit({ action: { type: "restore", employeeId: id, status: "pending" } });
    try {
      const submitted = await this.pageActions.submitWageChange({ employeeId: id, targetWage, apiWagesById: wagesMap(this.state.employees) });
      if (submitted?.status !== "submitted") {
        const reason = submitted?.reason || submitted?.status || "Pay restoration submission failed";
        this.#emit({ action: { type: "restore", employeeId: id, status: "failed", reason } });
        await this.#audit("restore", "failed", { employee, details: { reason, restoreWage: targetWage } });
        return { status: "failed", reason };
      }
      const poll = await this.#pollWage(id, targetWage);
      if (!poll.verified) {
        this.#emit({ stale: true, action: { type: "restore", employeeId: id, status: "unverified" } });
        await this.#audit("restore", "unverified", { employee, details: { restoreWage: targetWage } });
        return { status: "unverified" };
      }
      const restoredRecord = markRestoreVerified(record, this.nowSeconds());
      const payroll = {
        ...this.state.payroll,
        recordsByEmployeeId: { ...(this.state.payroll.recordsByEmployeeId || {}), [id]: restoredRecord }
      };
      await this.storage.savePayroll(payroll);
      this.#emit({ payroll });
      await this.refresh();
      this.#emit({ action: { type: "restore", employeeId: id, status: "verified" } });
      await this.#audit("restore", "verified", { employee, details: { restoredWage: targetWage } });
      return { status: "verified", record: restoredRecord };
    } catch (error) {
      const reason = String(error?.message || error);
      this.#emit({ action: { type: "restore", employeeId: id, status: "failed", reason } });
      await this.#audit("restore", "failed", { employee, details: { reason, restoreWage: targetWage } });
      throw error;
    } finally {
      this.actionLocks.delete(id);
    }
  }

  async getAudit() {
    if (typeof this.storage.loadAudit !== "function") return this.state.audit;
    try {
      const audit = await this.storage.loadAudit();
      this.#emit({ audit, auditError: null });
      return audit;
    } catch (error) {
      this.#emit({ auditError: String(error?.message || "Audit storage failed") });
      return this.state.audit;
    }
  }

  async clearAudit() {
    if (typeof this.storage.clearAudit !== "function") return this.state.audit;
    try {
      const audit = await this.storage.clearAudit();
      this.#emit({ audit, auditError: null });
      return audit;
    } catch (error) {
      this.#emit({ auditError: String(error?.message || "Audit storage failed") });
      return this.state.audit;
    }
  }

  getDiagnostics() {
    const nextId = this.state.rotation?.nextEmployeeId ?? null;
    const nextEmployee = this.#employee(nextId);
    const diagnostics = {
      generatedAt: this.nowSeconds(),
      controller: {
        status: this.state.status,
        stale: this.state.stale,
        error: this.state.error || null,
        lastUpdatedAt: this.state.lastUpdatedAt,
        trains: this.state.trains,
        employeeCount: this.state.employees.length,
        eligibleCount: this.state.rotation?.orderedEligible?.length ?? 0,
        skippedCount: this.state.rotation?.skipped?.length ?? 0,
        nextEmployeeId: nextEmployee?.id ?? null,
        nextEmployeeName: nextEmployee?.name ?? null,
        action: this.state.action || null,
        pendingManualTrainVerificationIds: [...this.unverifiedTrainIds],
        activeDockCount: activeDockCount(this.state.payroll)
      },
      history: {
        eventCount: Object.keys(this.state.history?.eventsByNewsId || {}).length,
        unresolvedCount: Object.keys(this.state.history?.unresolvedByNewsId || {}).length,
        newestTimestamp: Number(this.state.history?.newestTimestamp) || 0
      },
      audit: {
        entryCount: this.state.audit?.entries?.length ?? 0,
        storageError: this.state.auditError || null
      },
      page: this.pageActions.inspectTrainingEnvironment?.(nextId) || null
    };
    return sanitizeAuditValue(diagnostics);
  }

  async updateSettings(patch = {}) {
    if (!validSettingsPatch(patch)) throw new TypeError("Invalid training manager settings");
    const before = this.state.settings || {};
    const settings = await this.storage.saveSettings({ ...before, ...patch });
    this.#recompute({ settings });
    const changedKeys = changedSettingKeys(before, settings);
    if (changedKeys.length) {
      const safeValues = {};
      for (const key of changedKeys) safeValues[key] = settings[key];
      await this.#audit("settings", "changed", { details: { changedKeys, values: safeValues } });
    }
    return settings;
  }
}
