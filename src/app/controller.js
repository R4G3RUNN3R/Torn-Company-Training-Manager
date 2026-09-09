import { TrainingManagerController as V110TrainingManagerController } from "./controller-v110.js";
import { evaluateEligibility } from "../core/eligibility.js";
import { mergeTrainingNews, summarizeTrainingHistory } from "../core/history.js";
import { rankTrainingCandidates } from "../core/rotation.js";
import { createAuditEntry, sanitizeAuditValue } from "../core/audit.js";

const EMPTY_TRAIN_RECEIPTS = Object.freeze({ schemaVersion: 1, receiptsByEmployeeId: {} });
const TRAIN_CACHE_WAIT_MS = 31_000;

function employeeMap(employees) {
  return new Map((employees || []).map((employee) => [Number(employee.id), employee]));
}

function emptyRotation() {
  return { orderedEligible: [], skipped: [], nextEmployeeId: null, reasonById: new Map() };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeTrainReceipts(value) {
  const raw = isRecord(value?.receiptsByEmployeeId) ? value.receiptsByEmployeeId : {};
  const receiptsByEmployeeId = {};
  for (const [key, receipt] of Object.entries(raw)) {
    if (!isRecord(receipt)) continue;
    const id = Number(receipt.employeeId ?? key);
    if (!Number.isInteger(id)) continue;
    receiptsByEmployeeId[String(id)] = { ...clone(receipt), employeeId: id };
  }
  return { schemaVersion: 1, receiptsByEmployeeId };
}

function receiptConfirmedByHistory(receipt, history) {
  const employeeId = Number(receipt?.employeeId);
  if (!Number.isInteger(employeeId)) return false;
  const historyFloor = Number(receipt?.historyNewestTimestampBefore) || 0;
  const requestedAt = Number(receipt?.requestedAt) || 0;
  return Object.values(history?.eventsByNewsId || {}).some((event) => {
    if (Number(event?.employeeId) !== employeeId) return false;
    const timestamp = Number(event?.timestamp) || 0;
    if (timestamp <= historyFloor) return false;
    if (requestedAt > 0 && timestamp < requestedAt - 5) return false;
    return true;
  });
}

function reconcileTrainReceipts(value, history) {
  const current = normalizeTrainReceipts(value);
  const receiptsByEmployeeId = { ...current.receiptsByEmployeeId };
  let changed = false;
  for (const [key, receipt] of Object.entries(receiptsByEmployeeId)) {
    if (!receiptConfirmedByHistory(receipt, history)) continue;
    delete receiptsByEmployeeId[key];
    changed = true;
  }
  return { state: { schemaVersion: 1, receiptsByEmployeeId }, changed };
}

function hasNewTrainingEvent(history, beforeIds, employeeId = null) {
  return Object.entries(history?.eventsByNewsId || {}).some(([newsId, event]) => {
    if (beforeIds.has(newsId)) return false;
    return employeeId == null || Number(event?.employeeId) === Number(employeeId);
  });
}

export class TrainingManagerController extends V110TrainingManagerController {
  constructor(options) {
    super(options);
    this._trainAttemptSequence = 0;
    this.state = {
      ...this.state,
      trainReceipts: { ...EMPTY_TRAIN_RECEIPTS, receiptsByEmployeeId: {} }
    };
  }

  _emit(patch = {}) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners || []) {
      try { listener(this.state); } catch { }
    }
  }

  _recompute(extra = {}) {
    const employees = extra.employees ?? this.state.employees;
    const history = extra.history ?? this.state.history;
    const settings = extra.settings ?? this.state.settings;
    const eligibilityById = new Map();
    if (settings) {
      for (const employee of employees) {
        eligibilityById.set(Number(employee.id), evaluateEligibility(employee, settings, this.nowSeconds()));
      }
    }
    const trainingById = summarizeTrainingHistory(history, employees);
    const rotation = settings
      ? rankTrainingCandidates({ employees, eligibilityById, trainingById, settings })
      : emptyRotation();
    this._emit({ employees, history, settings, eligibilityById, trainingById, rotation, ...extra });
  }

  async _audit(type, phase, { employee = null, employeeId = null, employeeName = null, details = {} } = {}) {
    if (typeof this.storage.appendAudit !== "function") return null;
    const resolvedId = Number.isInteger(Number(employee?.id))
      ? Number(employee.id)
      : (Number.isInteger(Number(employeeId)) ? Number(employeeId) : null);
    const resolvedName = employee?.name ?? employeeName ?? null;
    const entry = createAuditEntry({
      type,
      phase,
      employeeId: resolvedId,
      employeeName: resolvedName,
      details
    }, this.nowSeconds());
    try {
      const audit = await this.storage.appendAudit(entry);
      this._emit({ audit, auditError: null });
      return entry;
    } catch (error) {
      this._emit({ auditError: String(error?.message || "Audit storage failed") });
      return null;
    }
  }

  async _saveTrainReceipts(value) {
    const normalized = normalizeTrainReceipts(value);
    const saved = typeof this.storage.saveTrainReceipts === "function"
      ? await this.storage.saveTrainReceipts(normalized)
      : normalized;
    const finalState = normalizeTrainReceipts(saved);
    this._emit({ trainReceipts: finalState });
    return finalState;
  }

  async _loadTrainReceipts(history = this.state.history) {
    const loaded = typeof this.storage.loadTrainReceipts === "function"
      ? await this.storage.loadTrainReceipts()
      : (this.state.trainReceipts || EMPTY_TRAIN_RECEIPTS);
    const reconciled = reconcileTrainReceipts(loaded, history);
    if (reconciled.changed && typeof this.storage.saveTrainReceipts === "function") {
      await this.storage.saveTrainReceipts(reconciled.state);
    }
    this._emit({ trainReceipts: reconciled.state });
    return reconciled.state;
  }

  _pendingReceipt(id, state = this.state.trainReceipts) {
    return state?.receiptsByEmployeeId?.[String(Number(id))] || null;
  }

  async _reserveTrainReceipt(employee, trainsBefore, historyNewestTimestampBefore) {
    const id = Number(employee.id);
    const current = await this._loadTrainReceipts(this.state.history);
    if (this._pendingReceipt(id, current)) {
      throw new Error("Previous train attempt is still pending verification; duplicate train blocked");
    }

    this._trainAttemptSequence += 1;
    const attemptId = `${this.nowSeconds()}-${id}-${this._trainAttemptSequence}`;
    const receipt = {
      employeeId: id,
      employeeName: employee.name,
      attemptId,
      requestedAt: this.nowSeconds(),
      acceptedAt: null,
      trainsBefore: Number(trainsBefore),
      historyNewestTimestampBefore: Number(historyNewestTimestampBefore) || 0,
      status: "submitting"
    };
    const next = normalizeTrainReceipts(current);
    next.receiptsByEmployeeId[String(id)] = receipt;
    await this._saveTrainReceipts(next);

    if (typeof this.storage.loadTrainReceipts === "function") {
      const verify = normalizeTrainReceipts(await this.storage.loadTrainReceipts());
      const winner = this._pendingReceipt(id, verify);
      if (winner?.attemptId !== attemptId) {
        this._emit({ trainReceipts: verify });
        throw new Error("Another training action acquired this employee first; duplicate train blocked");
      }
    }
    return receipt;
  }

  async _updateTrainReceipt(receipt, patch = {}) {
    const current = await this._loadTrainReceipts(this.state.history);
    const existing = this._pendingReceipt(receipt.employeeId, current);
    if (!existing || (existing.attemptId && receipt.attemptId && existing.attemptId !== receipt.attemptId)) {
      throw new Error("Train receipt changed in another tab; refusing to overwrite it");
    }
    const next = normalizeTrainReceipts(current);
    const updated = { ...existing, ...clone(patch), employeeId: Number(receipt.employeeId) };
    next.receiptsByEmployeeId[String(receipt.employeeId)] = updated;
    await this._saveTrainReceipts(next);
    return updated;
  }

  async _clearTrainReceipt(employeeId, attemptId = null) {
    const current = await this._loadTrainReceipts(this.state.history);
    const existing = this._pendingReceipt(employeeId, current);
    if (!existing) return current;
    if (attemptId && existing.attemptId && existing.attemptId !== attemptId) return current;
    const next = normalizeTrainReceipts(current);
    delete next.receiptsByEmployeeId[String(Number(employeeId))];
    return this._saveTrainReceipts(next);
  }

  async initialize() {
    await super.initialize();
    await this._loadTrainReceipts(this.state.history);
    return this.state;
  }

  async refresh() {
    await super.refresh();
    await this._loadTrainReceipts(this.state.history);
    return this.state;
  }

  async _readTrainingNews(history, { cacheBust = null } = {}) {
    const options = cacheBust == null ? {} : { cacheBust };
    const result = await this.api.getTrainingNewsSince(history?.newestTimestamp || 0, options);
    return {
      history: mergeTrainingNews(history, result?.news || []),
      complete: result?.complete !== false,
      reason: result?.reason || null
    };
  }

  async _preflightTrain(id) {
    const historyBefore = this.state.history;
    const beforeIds = new Set(Object.keys(historyBefore?.eventsByNewsId || {}));
    const trainsBefore = Number(this.state.trains);
    const snapshotEmployee = employeeMap(this.state.employees).get(Number(id)) || null;
    await this._audit("train", "preflight_started", {
      employee: snapshotEmployee,
      employeeId: id,
      details: { trainsBefore, newestHistoryTimestamp: Number(historyBefore?.newestTimestamp) || 0 }
    });

    const [employees, profile, newsResult] = await Promise.all([
      this.api.getEmployees(),
      this.api.getProfile(),
      this.api.getTrainingNewsSince(historyBefore?.newestTimestamp || 0, { cacheBust: this.nowSeconds() })
    ]);
    const freshHistory = mergeTrainingNews(historyBefore, newsResult?.news || []);
    const freshTrains = Number.isFinite(Number(profile?.trains)) ? Number(profile.trains) : null;
    const lastUpdatedAt = this.nowSeconds();
    await this.storage.saveHistory(freshHistory);
    await this.storage.saveCache({ employees, trains: freshTrains, profile, lastUpdatedAt });
    await this._loadTrainReceipts(freshHistory);

    const freshEmployee = employeeMap(employees).get(Number(id)) || null;
    const freshEligibility = freshEmployee && this.state.settings
      ? evaluateEligibility(freshEmployee, this.state.settings, this.nowSeconds())
      : null;
    const newsChanged = hasNewTrainingEvent(freshHistory, beforeIds);
    const trainsChanged = Number.isFinite(trainsBefore) && freshTrains !== trainsBefore;
    const missing = !freshEmployee;
    const ineligible = !freshEligibility?.eligible;

    this._recompute({
      employees,
      profile,
      trains: freshTrains,
      history: freshHistory,
      stale: false,
      lastUpdatedAt,
      status: newsResult?.complete === false ? "partial" : "ready",
      error: newsResult?.complete === false ? `Training news sync incomplete: ${newsResult.reason || "unknown"}` : null
    });

    if (newsChanged || trainsChanged || missing || ineligible || !Number.isFinite(freshTrains) || freshTrains <= 0) {
      const reason = "training_state_changed";
      const result = { status: "preflight_changed", reason };
      this._emit({ action: { type: "train", employeeId: id, status: "preflight_changed", reason } });
      await this._audit("train", "preflight_changed", {
        employee: freshEmployee || snapshotEmployee,
        employeeId: id,
        details: {
          reason,
          newsChanged,
          trainsChanged,
          trainsBefore,
          trainsNow: freshTrains,
          employeeMissing: missing,
          employeeEligible: Boolean(freshEligibility?.eligible)
        }
      });
      return { ok: false, result };
    }

    await this._audit("train", "preflight_ok", {
      employee: freshEmployee,
      details: { trainsBefore: freshTrains }
    });
    return {
      ok: true,
      employee: freshEmployee,
      eligibility: freshEligibility,
      beforeIds,
      trainsBefore: freshTrains,
      historyNewestTimestampBefore: Number(freshHistory?.newestTimestamp) || 0
    };
  }

  async trainEmployee(id) {
    id = Number(id);
    if (this.state.stale) throw new Error("Current company data is stale; refresh before making changes");
    if (this.actionLocks.has(id)) throw new Error("An action is already pending for this employee");

    const receipts = await this._loadTrainReceipts(this.state.history);
    if (this._pendingReceipt(id, receipts)) {
      await this._audit("train", "blocked_pending_receipt", { employeeId: id, details: { reason: "pending_train_receipt" } });
      throw new Error("Previous train attempt is still pending verification; duplicate train blocked");
    }

    const employee = employeeMap(this.state.employees).get(id) || null;
    const eligibility = this.state.eligibilityById.get(id) || null;
    if (!employee) throw new Error("Employee not found");
    if (!eligibility?.eligible) throw new Error("Employee is not eligible for training");
    if (!Number.isFinite(Number(this.state.trains)) || Number(this.state.trains) <= 0) throw new Error("No company trains are available");

    this.actionLocks.add(id);
    let receipt = null;
    try {
      this._emit({ action: { type: "train", employeeId: id, status: "preflight" } });
      const preflight = await this._preflightTrain(id);
      if (!preflight.ok) return preflight.result;

      const latestReceipts = await this._loadTrainReceipts(this.state.history);
      if (this._pendingReceipt(id, latestReceipts)) {
        throw new Error("Another training action is pending for this employee; duplicate train blocked");
      }

      receipt = await this._reserveTrainReceipt(
        preflight.employee,
        preflight.trainsBefore,
        preflight.historyNewestTimestampBefore
      );
      await this._audit("train", "requested", {
        employee: preflight.employee,
        details: {
          trainsBefore: preflight.trainsBefore,
          attemptId: receipt.attemptId,
          eligibilityReasons: (preflight.eligibility?.reasons || []).map((reason) => reason.code)
        }
      });
      this._emit({ action: { type: "train", employeeId: id, status: "pending" } });

      const submitted = await this.pageActions.submitTrain(id);
      if (submitted?.status === "rejected") {
        const reason = submitted?.reason || "Torn rejected the training request";
        await this._clearTrainReceipt(id, receipt.attemptId);
        this._emit({ action: { type: "train", employeeId: id, status: "rejected", reason } });
        await this._audit("train", "rejected", { employee: preflight.employee, details: { reason, trainsBefore: preflight.trainsBefore } });
        return { status: "rejected", reason };
      }

      if (submitted?.status !== "accepted") {
        const reason = submitted?.reason || submitted?.status || "Training request outcome is unknown";
        receipt = await this._updateTrainReceipt(receipt, {
          status: "submission_unknown",
          lastError: reason
        });
        const warning = "Training request outcome is unknown. Duplicate retry is blocked until Company News or a manual refresh verifies what happened.";
        this._emit({ action: { type: "train", employeeId: id, status: "submission_unknown", reason: warning } });
        await this._audit("train", "submission_unknown", { employee: preflight.employee, details: { reason } });
        return { status: "submission_unknown", reason: warning };
      }

      receipt = await this._updateTrainReceipt(receipt, {
        status: "accepted_unverified",
        acceptedAt: this.nowSeconds(),
        httpStatus: submitted?.httpStatus || null
      });
      this._emit({ action: { type: "train", employeeId: id, status: "accepted" } });
      await this._audit("train", "accepted", { employee: preflight.employee, details: { trainsBefore: preflight.trainsBefore } });

      let check = await this._readTrainingNews(this.state.history);
      let workingHistory = check.history;
      if (hasNewTrainingEvent(workingHistory, preflight.beforeIds, id)) {
        await this.storage.saveHistory(workingHistory);
        await this._clearTrainReceipt(id, receipt.attemptId);
        this._recompute({ history: workingHistory });
        await this.refresh();
        this._emit({ action: { type: "train", employeeId: id, status: "verified" } });
        await this._audit("train", "verified", { employee: preflight.employee, details: { trainsAfter: this.state.trains } });
        return { status: "verified" };
      }

      this._recompute({
        history: workingHistory,
        action: { type: "train", employeeId: id, status: "awaiting_verification", retryAfterSeconds: 31 }
      });
      await this._audit("train", "awaiting_verification", { employee: preflight.employee, details: { retryAfterSeconds: 31 } });
      await this.sleep(TRAIN_CACHE_WAIT_MS);

      check = await this._readTrainingNews(workingHistory, { cacheBust: this.nowSeconds() });
      workingHistory = check.history;
      await this.storage.saveHistory(workingHistory);
      if (!hasNewTrainingEvent(workingHistory, preflight.beforeIds, id)) {
        const reason = "Torn accepted the request, but Company News has not confirmed it yet. This employee stays locked across refreshes, reloads and tabs until verification succeeds.";
        receipt = await this._updateTrainReceipt(receipt, { status: "accepted_unverified" });
        this._recompute({
          history: workingHistory,
          trainReceipts: this.state.trainReceipts,
          action: { type: "train", employeeId: id, status: "accepted_unverified", reason }
        });
        await this._audit("train", "accepted_unverified", { employee: preflight.employee, details: { reason } });
        return { status: "accepted_unverified" };
      }

      await this._clearTrainReceipt(id, receipt.attemptId);
      this._recompute({ history: workingHistory });
      await this.refresh();
      this._emit({ action: { type: "train", employeeId: id, status: "verified" } });
      await this._audit("train", "verified", { employee: preflight.employee, details: { trainsAfter: this.state.trains } });
      return { status: "verified" };
    } catch (error) {
      const reason = String(error?.message || error);
      this._emit({ action: { type: "train", employeeId: id, status: "failed", reason } });
      await this._audit("train", "failed", { employee: employee || null, employeeId: id, details: { reason } });
      throw error;
    } finally {
      this.actionLocks.delete(id);
    }
  }

  getDiagnostics() {
    const diagnostics = super.getDiagnostics();
    const receipts = normalizeTrainReceipts(this.state.trainReceipts);
    diagnostics.controller.pendingManualTrainVerificationIds = Object.keys(receipts.receiptsByEmployeeId).map(Number);
    diagnostics.controller.pendingTrainReceiptCount = Object.keys(receipts.receiptsByEmployeeId).length;
    diagnostics.controller.pendingTrainReceiptStates = Object.values(receipts.receiptsByEmployeeId).map((receipt) => ({
      employeeId: receipt.employeeId,
      employeeName: receipt.employeeName || null,
      status: receipt.status || null,
      requestedAt: receipt.requestedAt || null,
      acceptedAt: receipt.acceptedAt || null
    }));
    return sanitizeAuditValue(diagnostics);
  }
}
