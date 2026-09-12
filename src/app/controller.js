import { TrainingManagerController as IdempotencyController } from "./controller-idempotency-base.js";
import { buildTrainingRecommendation } from "../core/recommendation.js";
import {
  emptyPaidState,
  normalizePaidState,
  createPaidContract,
  amendPaidContract,
  syncPaidEligibility,
  recordVerifiedPaidTrain,
  reorderPaidQueue,
  closePaidContract
} from "../core/paid-contracts.js";
import { emptyFairnessState, normalizeFairnessState, recordFairnessTrain } from "../core/fairness.js";
import {
  emptyOverrideState,
  normalizeOverrideState,
  setPriorityOnce as setPriorityOnceState,
  clearPriorityOnce as clearPriorityOnceState,
  createSkip,
  clearSkip as clearSkipState,
  expireOverrides
} from "../core/overrides.js";

const DEFAULT_RECEIPT_SETTLE_MS = 200;

function defaultAttemptId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch {
    // Fall through to a local high-entropy identifier.
  }
  const randomPart = () => Math.random().toString(36).slice(2);
  return `${Date.now()}-${randomPart()}-${randomPart()}`;
}

function wagesMap(employees) {
  return new Map((employees || [])
    .filter((employee) => Number.isInteger(Number(employee?.id)) && Number.isInteger(employee?.wage))
    .map((employee) => [Number(employee.id), employee.wage]));
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeReceipts(value) {
  const out = { schemaVersion: 1, receiptsByEmployeeId: {} };
  const raw = value?.receiptsByEmployeeId && typeof value.receiptsByEmployeeId === "object" ? value.receiptsByEmployeeId : {};
  for (const [key, receipt] of Object.entries(raw)) {
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) continue;
    const id = Number(receipt.employeeId ?? key);
    if (!Number.isInteger(id) || id <= 0) continue;
    out.receiptsByEmployeeId[String(id)] = { ...clone(receipt), employeeId: id };
  }
  return out;
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

function paidChanged(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function paidContractForEmployee(paid, employeeId) {
  const state = normalizePaidState(paid);
  const contractId = state.activeByEmployeeId[String(Number(employeeId))];
  return contractId ? state.contractsById[contractId] || null : null;
}

export class TrainingManagerController extends IdempotencyController {
  constructor(options = {}) {
    super(options);
    this._attemptIdFactory = typeof options.attemptIdFactory === "function"
      ? options.attemptIdFactory
      : defaultAttemptId;
    const settleMs = Number(options.receiptSettleMs);
    this._receiptSettleMs = Number.isFinite(settleMs) && settleMs >= 0
      ? settleMs
      : DEFAULT_RECEIPT_SETTLE_MS;
    this._premiumLoaded = false;
    this._trainContextByEmployeeId = new Map();
    this.state = {
      ...this.state,
      paid: emptyPaidState(),
      fairness: emptyFairnessState(this.nowSeconds()),
      overrides: emptyOverrideState(),
      recommendation: null
    };
  }

  _recompute(extra = {}) {
    super._recompute(extra);
    const paidInput = extra.paid ?? this.state.paid ?? emptyPaidState();
    const fairness = normalizeFairnessState(extra.fairness ?? this.state.fairness ?? emptyFairnessState(this.nowSeconds()));
    const overrides = expireOverrides(
      normalizeOverrideState(extra.overrides ?? this.state.overrides ?? emptyOverrideState()),
      {
        nowSeconds: this.nowSeconds(),
        verifiedTrainCount: Object.keys(this.state.history?.eventsByNewsId || {}).length
      }
    );
    const paid = syncPaidEligibility(paidInput, this.state.eligibilityById, this.nowSeconds());
    const recommendation = this.state.settings
      ? buildTrainingRecommendation({
        employees: this.state.employees,
        eligibilityById: this.state.eligibilityById,
        trainingById: this.state.trainingById,
        settings: this.state.settings,
        paidState: paid,
        overrideState: overrides,
        fairnessState: fairness,
        trainReceipts: this.state.trainReceipts,
        nowSeconds: this.nowSeconds(),
        verifiedTrainCount: Object.keys(this.state.history?.eventsByNewsId || {}).length
      })
      : null;
    this._emit({ paid, fairness, overrides, recommendation });
  }

  async _loadPremiumDomains() {
    const [paid, fairness, overrides] = await Promise.all([
      typeof this.storage.loadPaidContracts === "function" ? this.storage.loadPaidContracts() : Promise.resolve(emptyPaidState()),
      typeof this.storage.loadFairness === "function" ? this.storage.loadFairness() : Promise.resolve(emptyFairnessState(this.nowSeconds())),
      typeof this.storage.loadOverrides === "function" ? this.storage.loadOverrides() : Promise.resolve(emptyOverrideState())
    ]);
    this._premiumLoaded = true;
    this._recompute({ paid, fairness, overrides });
    await this._persistDerivedPremiumState({ paidBefore: paid, overridesBefore: overrides });
  }

  async _persistDerivedPremiumState({ paidBefore = null, overridesBefore = null } = {}) {
    if (!this._premiumLoaded) return;
    if (typeof this.storage.savePaidContracts === "function" && (paidBefore == null || paidChanged(paidBefore, this.state.paid))) {
      const saved = await this.storage.savePaidContracts(this.state.paid);
      this.state.paid = normalizePaidState(saved);
    }
    if (typeof this.storage.saveOverrides === "function" && overridesBefore != null && JSON.stringify(overridesBefore) !== JSON.stringify(this.state.overrides)) {
      const saved = await this.storage.saveOverrides(this.state.overrides);
      this.state.overrides = normalizeOverrideState(saved);
    }
  }

  async initialize() {
    await super.initialize();
    await this._loadPremiumDomains();
    await this._loadTrainReceipts(this.state.history);
    return this.state;
  }

  async refresh() {
    const beforePaid = clone(this.state.paid || emptyPaidState());
    const result = await super.refresh();
    if (this._premiumLoaded) await this._persistDerivedPremiumState({ paidBefore: beforePaid });
    return result;
  }

  async _accountVerifiedReceipt(receipt) {
    if (!this._premiumLoaded || !receipt) return;
    const employeeId = Number(receipt.employeeId);
    if (!Number.isInteger(employeeId)) return;

    let fairness = this.state.fairness;
    if (Array.isArray(receipt.fairnessEligibleEmployeeIds)) {
      fairness = recordFairnessTrain(fairness, {
        timestamp: this.nowSeconds(),
        eligibleEmployeeIds: receipt.fairnessEligibleEmployeeIds,
        allEmployeeIds: Array.isArray(receipt.fairnessAllEmployeeIds) ? receipt.fairnessAllEmployeeIds : receipt.fairnessEligibleEmployeeIds,
        trainedEmployeeId: employeeId
      });
      if (typeof this.storage.saveFairness === "function") fairness = await this.storage.saveFairness(fairness);
    }

    let paid = this.state.paid;
    const countsTowardPaid = receipt.countsTowardPaid === true;
    if (countsTowardPaid) {
      paid = recordVerifiedPaidTrain(paid, employeeId, { timestamp: this.nowSeconds(), countsTowardPaid: true });
      if (typeof this.storage.savePaidContracts === "function") paid = await this.storage.savePaidContracts(paid);
    }

    let overrides = this.state.overrides;
    if (Number(overrides?.priorityOnceEmployeeId) === employeeId) {
      overrides = clearPriorityOnceState(overrides);
      if (typeof this.storage.saveOverrides === "function") overrides = await this.storage.saveOverrides(overrides);
      await this._audit("priority", "consumed", { employeeId, details: { reason: "verified_train" } });
    }

    this._recompute({ paid, fairness, overrides });
    if (countsTowardPaid) await this._audit("train", "verified_paid", { employeeId, details: { recommendationSource: receipt.recommendationSource || null } });
    else if (paidContractForEmployee(this.state.paid, employeeId)) await this._audit("train", "verified_bonus", { employeeId, details: { recommendationSource: receipt.recommendationSource || null } });
  }

  async _loadTrainReceipts(history = this.state.history) {
    const loaded = typeof this.storage.loadTrainReceipts === "function"
      ? normalizeReceipts(await this.storage.loadTrainReceipts())
      : normalizeReceipts(this.state.trainReceipts);
    const next = normalizeReceipts(loaded);
    let changed = false;

    if (this._premiumLoaded) {
      for (const [key, receipt] of Object.entries(loaded.receiptsByEmployeeId)) {
        if (!receiptConfirmedByHistory(receipt, history)) continue;
        await this._accountVerifiedReceipt(receipt);
        delete next.receiptsByEmployeeId[key];
        changed = true;
      }
    }

    if (changed && typeof this.storage.saveTrainReceipts === "function") await this.storage.saveTrainReceipts(next);
    this._recompute({ history, trainReceipts: next });
    return next;
  }

  async trainEmployee(id, options = {}) {
    id = Number(id);
    const activePaid = paidContractForEmployee(this.state.paid, id);
    const countsTowardPaid = Object.prototype.hasOwnProperty.call(options, "countsTowardPaid")
      ? options.countsTowardPaid === true
      : Boolean(activePaid);
    const source = this.state.recommendation?.sourceById?.get?.(id) || (activePaid ? "paid" : "manual");
    const eligibleIds = [...(this.state.eligibilityById || new Map()).entries()]
      .filter(([, eligibility]) => eligibility?.eligible === true)
      .map(([employeeId]) => Number(employeeId));
    const allEmployeeIds = (this.state.employees || []).map((employee) => Number(employee.id)).filter(Number.isInteger);
    this._trainContextByEmployeeId.set(id, {
      countsTowardPaid,
      recommendationSource: source,
      fairnessEligibleEmployeeIds: eligibleIds,
      fairnessAllEmployeeIds: allEmployeeIds
    });
    try {
      return await super.trainEmployee(id);
    } finally {
      this._trainContextByEmployeeId.delete(id);
    }
  }

  async _reserveTrainReceipt(employee, trainsBefore, historyNewestTimestampBefore) {
    const id = Number(employee?.id);
    if (!Number.isInteger(id)) throw new Error("Employee not found");

    const current = await this._loadTrainReceipts(this.state.history);
    if (this._pendingReceipt(id, current)) throw new Error("Previous train attempt is still pending verification; duplicate train blocked");

    const uniquePart = String(this._attemptIdFactory() || "").trim();
    if (!uniquePart) throw new Error("Could not create a unique training attempt identifier");
    const attemptId = `${this.nowSeconds()}-${id}-${uniquePart}`;
    const context = this._trainContextByEmployeeId.get(id) || {};
    const receipt = {
      employeeId: id,
      employeeName: employee.name,
      attemptId,
      requestedAt: this.nowSeconds(),
      acceptedAt: null,
      trainsBefore: Number(trainsBefore),
      historyNewestTimestampBefore: Number(historyNewestTimestampBefore) || 0,
      status: "submitting",
      recommendationSource: context.recommendationSource || "manual",
      countsTowardPaid: context.countsTowardPaid === true,
      fairnessEligibleEmployeeIds: Array.isArray(context.fairnessEligibleEmployeeIds) ? [...context.fairnessEligibleEmployeeIds] : [],
      fairnessAllEmployeeIds: Array.isArray(context.fairnessAllEmployeeIds) ? [...context.fairnessAllEmployeeIds] : []
    };

    const next = { schemaVersion: 1, receiptsByEmployeeId: { ...(current?.receiptsByEmployeeId || {}), [String(id)]: receipt } };
    await this._saveTrainReceipts(next);

    if (this._receiptSettleMs > 0) await this.sleep(this._receiptSettleMs);
    const verify = await this._loadTrainReceipts(this.state.history);
    const winner = this._pendingReceipt(id, verify);
    if (winner?.attemptId !== attemptId) throw new Error("Another training action acquired this employee first; duplicate train blocked");
    return receipt;
  }

  async createPaidAgreement(input) {
    let paid = createPaidContract(this.state.paid, { ...input, createdAt: input?.createdAt ?? this.nowSeconds() });
    if (typeof this.storage.savePaidContracts === "function") paid = await this.storage.savePaidContracts(paid);
    this._recompute({ paid });
    await this._audit("paid_contract", "created", { employeeId: input?.employeeId, employeeName: input?.employeeName, details: { trainsPurchased: Number(input?.trainsPurchased) } });
    return paid;
  }

  async amendPaidAgreement(employeeId, patch) {
    let paid = amendPaidContract(this.state.paid, employeeId, patch, this.nowSeconds());
    if (typeof this.storage.savePaidContracts === "function") paid = await this.storage.savePaidContracts(paid);
    this._recompute({ paid });
    await this._audit("paid_contract", "amended", { employeeId, details: { addTrains: Number(patch?.addTrains) || 0 } });
    return paid;
  }

  async reorderPaidAgreements(contractIds) {
    let paid = reorderPaidQueue(this.state.paid, contractIds);
    if (typeof this.storage.savePaidContracts === "function") paid = await this.storage.savePaidContracts(paid);
    this._recompute({ paid });
    return paid;
  }

  async closePaidAgreement(employeeId, options) {
    let paid = closePaidContract(this.state.paid, employeeId, { ...options, timestamp: options?.timestamp ?? this.nowSeconds() });
    if (typeof this.storage.savePaidContracts === "function") paid = await this.storage.savePaidContracts(paid);
    this._recompute({ paid });
    await this._audit("paid_contract", options?.outcome || "closed", { employeeId, details: { reason: options?.reason || null } });
    return paid;
  }

  async setPriorityOnce(employeeId) {
    const eligibility = this.state.eligibilityById?.get?.(Number(employeeId));
    if (!eligibility?.eligible) throw new Error("Employee is not eligible for priority training");
    let overrides = setPriorityOnceState(this.state.overrides, employeeId, this.nowSeconds());
    if (typeof this.storage.saveOverrides === "function") overrides = await this.storage.saveOverrides(overrides);
    this._recompute({ overrides });
    await this._audit("priority", "added", { employeeId });
    return overrides;
  }

  async clearPriorityOnce() {
    const employeeId = this.state.overrides?.priorityOnceEmployeeId ?? null;
    let overrides = clearPriorityOnceState(this.state.overrides);
    if (typeof this.storage.saveOverrides === "function") overrides = await this.storage.saveOverrides(overrides);
    this._recompute({ overrides });
    await this._audit("priority", "cleared", { employeeId });
    return overrides;
  }

  async skipEmployee(employeeId, options) {
    const verifiedTrainCount = Object.keys(this.state.history?.eventsByNewsId || {}).length;
    let overrides = createSkip(this.state.overrides, employeeId, { ...options, createdAt: options?.createdAt ?? this.nowSeconds(), verifiedTrainCountAtCreate: options?.verifiedTrainCountAtCreate ?? verifiedTrainCount });
    if (typeof this.storage.saveOverrides === "function") overrides = await this.storage.saveOverrides(overrides);
    this._recompute({ overrides });
    await this._audit("skip", "created", { employeeId, details: { mode: options?.mode || null, until: options?.until || null } });
    return overrides;
  }

  async clearSkip(employeeId) {
    let overrides = clearSkipState(this.state.overrides, employeeId);
    if (typeof this.storage.saveOverrides === "function") overrides = await this.storage.saveOverrides(overrides);
    this._recompute({ overrides });
    await this._audit("skip", "cleared", { employeeId });
    return overrides;
  }

  getDiagnostics() {
    const diagnostics = super.getDiagnostics();
    const actionId = Number(this.state.action?.employeeId);
    const targetId = Number.isInteger(actionId) && actionId > 0
      ? actionId
      : (this.state.recommendation?.nextEmployeeId ?? this.state.rotation?.nextEmployeeId ?? null);
    const payroll = this.pageActions.inspectPayrollEnvironment?.(wagesMap(this.state.employees), targetId) || null;
    const page = diagnostics?.page && typeof diagnostics.page === "object" ? diagnostics.page : {};
    return {
      ...diagnostics,
      controller: {
        ...diagnostics.controller,
        recommendationNextEmployeeId: this.state.recommendation?.nextEmployeeId ?? null,
        paidAgreementCount: Object.keys(this.state.paid?.activeByEmployeeId || {}).length,
        fairnessTrackingStartedAt: this.state.fairness?.trackingStartedAt ?? null
      },
      page: { ...page, payroll }
    };
  }
}
