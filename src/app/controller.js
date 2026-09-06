import { evaluateEligibility } from "../core/eligibility.js";
import { emptyHistoryState, mergeTrainingNews, summarizeTrainingHistory } from "../core/history.js";
import { rankTrainingCandidates } from "../core/rotation.js";
import { createDockRecord, markDockVerified, getRestoreState, markRestoreVerified } from "../core/payroll.js";

const emptyRotation = () => ({ orderedEligible: [], skipped: [], nextEmployeeId: null, reasonById: new Map() });

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

  async initialize() {
    const [settings, history, payroll, cache] = await Promise.all([
      this.storage.loadSettings(),
      this.storage.loadHistory(),
      this.storage.loadPayroll(),
      this.storage.loadCache()
    ]);
    this.state = {
      ...this.state,
      settings,
      history,
      payroll,
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
      this.#emit({ status: "error", stale: true, error: String(error?.message || "Unable to refresh Torn data"), action: null });
    }
    return this.state;
  }

  async rebuildHistory() {
    if (this.state.stale) throw new Error("Cannot rebuild history while current data is stale");
    this.#emit({ status: "rebuilding_history", action: { type: "history", status: "pending" } });
    const result = await this.api.rebuildTrainingNews();
    const history = mergeTrainingNews(emptyHistoryState(), result.news || []);
    await this.storage.saveHistory(history);
    this.#recompute({ history, status: result.complete ? "ready" : "partial", action: { type: "history", status: result.complete ? "verified" : "incomplete" } });
    return { status: result.complete ? "verified" : "incomplete", reason: result.reason || null };
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

  async trainEmployee(id) {
    id = Number(id);
    this.#assertFresh();
    if (this.unverifiedTrainIds.has(id)) throw new Error("Previous train attempt is unverified; refresh before retrying");
    if (this.actionLocks.has(id)) throw new Error("An action is already pending for this employee");
    const employee = this.#employee(id);
    const eligibility = this.#eligibility(id);
    if (!employee) throw new Error("Employee not found");
    if (!eligibility?.eligible) throw new Error("Employee is not eligible for training");
    if (!Number.isFinite(Number(this.state.trains)) || Number(this.state.trains) <= 0) throw new Error("No company trains are available");

    this.actionLocks.add(id);
    this.#emit({ action: { type: "train", employeeId: id, status: "pending" } });
    try {
      const beforeIds = new Set(Object.keys(this.state.history.eventsByNewsId || {}));
      const submitted = await this.pageActions.submitTrain(id);
      if (submitted?.status !== "submitted") {
        this.#emit({ action: { type: "train", employeeId: id, status: "failed", reason: submitted?.reason || submitted?.status } });
        return { status: "failed", reason: submitted?.reason || submitted?.status };
      }

      let workingHistory = this.state.history;
      let verified = false;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (attempt > 0) await this.sleep(1500);
        const newsResult = await this.api.getTrainingNewsSince(workingHistory.newestTimestamp || 0);
        workingHistory = mergeTrainingNews(workingHistory, newsResult.news || []);
        verified = Object.entries(workingHistory.eventsByNewsId || {}).some(([newsId, event]) => !beforeIds.has(newsId) && Number(event.employeeId) === id);
        if (verified) break;
      }
      await this.storage.saveHistory(workingHistory);
      if (!verified) {
        this.unverifiedTrainIds.add(id);
        this.#recompute({ history: workingHistory, action: { type: "train", employeeId: id, status: "unverified" } });
        return { status: "unverified" };
      }

      this.#recompute({ history: workingHistory });
      await this.refresh();
      this.#emit({ action: { type: "train", employeeId: id, status: "verified" } });
      return { status: "verified" };
    } catch (error) {
      this.#emit({ action: { type: "train", employeeId: id, status: "failed", reason: String(error?.message || error) } });
      throw error;
    } finally {
      this.actionLocks.delete(id);
    }
  }

  async #pollWage(employeeId, targetWage) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await this.sleep(1500);
      const employees = await this.api.getEmployees();
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

    this.actionLocks.add(id);
    this.#emit({ action: { type: "dock", employeeId: id, status: "pending" } });
    try {
      const submitted = await this.pageActions.submitWageChange({ employeeId: id, targetWage, apiWagesById: wagesMap(this.state.employees) });
      if (submitted?.status !== "submitted") {
        this.#emit({ action: { type: "dock", employeeId: id, status: "failed", reason: submitted?.reason || submitted?.status } });
        return { status: "failed", reason: submitted?.reason || submitted?.status };
      }
      const poll = await this.#pollWage(id, targetWage);
      if (!poll.verified) {
        this.#emit({ stale: true, action: { type: "dock", employeeId: id, status: "unverified" } });
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
      return { status: "verified", record: verifiedRecord };
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

    this.actionLocks.add(id);
    this.#emit({ action: { type: "restore", employeeId: id, status: "pending" } });
    try {
      const targetWage = restoreState.restoreWage;
      const submitted = await this.pageActions.submitWageChange({ employeeId: id, targetWage, apiWagesById: wagesMap(this.state.employees) });
      if (submitted?.status !== "submitted") {
        this.#emit({ action: { type: "restore", employeeId: id, status: "failed", reason: submitted?.reason || submitted?.status } });
        return { status: "failed", reason: submitted?.reason || submitted?.status };
      }
      const poll = await this.#pollWage(id, targetWage);
      if (!poll.verified) {
        this.#emit({ stale: true, action: { type: "restore", employeeId: id, status: "unverified" } });
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
      return { status: "verified", record: restoredRecord };
    } finally {
      this.actionLocks.delete(id);
    }
  }

  async updateSettings(patch = {}) {
    if (!validSettingsPatch(patch)) throw new TypeError("Invalid training manager settings");
    const settings = await this.storage.saveSettings({ ...this.state.settings, ...patch });
    this.#recompute({ settings });
    return settings;
  }
}
