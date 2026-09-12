import { rankTrainingCandidates } from "./rotation.js";
import { fairnessScores } from "./fairness.js";
import { isSkipped } from "./overrides.js";
import { normalizePaidState } from "./paid-contracts.js";

function getFrom(mapLike, id) {
  if (mapLike instanceof Map) return mapLike.get(id) ?? mapLike.get(String(id));
  return mapLike?.[id] ?? mapLike?.[String(id)];
}

function numericId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function pendingReceipt(trainReceipts, id) {
  return trainReceipts?.receiptsByEmployeeId?.[id] ?? trainReceipts?.receiptsByEmployeeId?.[String(id)] ?? null;
}

function employeeById(employees) {
  const map = new Map();
  for (const employee of employees || []) {
    const id = numericId(employee?.id);
    if (id) map.set(id, employee);
  }
  return map;
}

function fairnessLabel(score) {
  if (!Number.isFinite(score) || Math.abs(score) < 0.05) return "On balance";
  return score > 0 ? `Behind by ${score.toFixed(1)}` : `Ahead by ${Math.abs(score).toFixed(1)}`;
}

export function buildTrainingRecommendation({
  employees = [],
  eligibilityById,
  trainingById,
  settings = {},
  paidState,
  overrideState,
  fairnessState,
  trainReceipts = { receiptsByEmployeeId: {} },
  nowSeconds = Math.floor(Date.now() / 1000),
  verifiedTrainCount = null
} = {}) {
  const byId = employeeById(employees);
  const paid = normalizePaidState(paidState);
  const ordered = [];
  const seen = new Set();
  const skipped = [];
  const reasonById = new Map();
  const sourceById = new Map();
  const paidContractByEmployeeId = new Map();
  const fairnessById = fairnessScores(fairnessState, {
    nowSeconds,
    windowDays: Number(settings.fairnessWindowDays) || 30,
    accrueDebtWhileIneligible: settings.accrueDebtWhileIneligible === true
  });

  const canRecommend = (id) => {
    const employee = byId.get(id);
    if (!employee) return false;
    if (getFrom(eligibilityById, id)?.eligible !== true) {
      reasonById.set(id, "ineligible");
      return false;
    }
    if (pendingReceipt(trainReceipts, id)) {
      reasonById.set(id, "pending_train_verification");
      return false;
    }
    if (isSkipped(overrideState, id, { nowSeconds, verifiedTrainCount })) {
      reasonById.set(id, "skipped");
      return false;
    }
    return true;
  };

  for (const employee of employees || []) {
    const id = numericId(employee?.id);
    if (!id) continue;
    if (!getFrom(eligibilityById, id)?.eligible) reasonById.set(id, "ineligible");
    else if (pendingReceipt(trainReceipts, id)) reasonById.set(id, "pending_train_verification");
    else if (isSkipped(overrideState, id, { nowSeconds, verifiedTrainCount })) reasonById.set(id, "skipped");
  }

  for (const contractId of paid.queue) {
    const contract = paid.contractsById[contractId];
    if (!contract || contract.status !== "active") continue;
    const id = numericId(contract.employeeId);
    if (!id || !canRecommend(id) || seen.has(id)) continue;
    const employee = byId.get(id);
    ordered.push(employee);
    seen.add(id);
    reasonById.set(id, "paid_priority");
    sourceById.set(id, "paid");
    paidContractByEmployeeId.set(id, contract);
  }

  const priorityId = numericId(overrideState?.priorityOnceEmployeeId);
  if (priorityId && !seen.has(priorityId) && canRecommend(priorityId)) {
    ordered.push(byId.get(priorityId));
    seen.add(priorityId);
    reasonById.set(priorityId, "priority_once");
    sourceById.set(priorityId, "priority_once");
  }

  const remaining = (employees || []).filter((employee) => {
    const id = numericId(employee?.id);
    return id && !seen.has(id) && canRecommend(id);
  });

  if (settings.rotationMode === "balanced") {
    const fairFallback = rankTrainingCandidates({ employees: remaining, eligibilityById, trainingById, settings });
    const fallbackIndex = new Map(fairFallback.orderedEligible.map((employee, index) => [Number(employee.id), index]));
    remaining.sort((a, b) => {
      const aid = Number(a.id);
      const bid = Number(b.id);
      const scoreDiff = (fairnessById.get(bid) || 0) - (fairnessById.get(aid) || 0);
      if (Math.abs(scoreDiff) > 1e-12) return scoreDiff;
      return (fallbackIndex.get(aid) ?? Number.MAX_SAFE_INTEGER) - (fallbackIndex.get(bid) ?? Number.MAX_SAFE_INTEGER);
    });
    for (const employee of remaining) {
      const id = Number(employee.id);
      ordered.push(employee);
      seen.add(id);
      reasonById.set(id, "balanced_behind");
      sourceById.set(id, "balanced_fairness");
    }
  } else {
    const normal = rankTrainingCandidates({ employees: remaining, eligibilityById, trainingById, settings });
    for (const employee of normal.orderedEligible) {
      const id = Number(employee.id);
      ordered.push(employee);
      seen.add(id);
      reasonById.set(id, normal.reasonById.get(id) || "queued");
      sourceById.set(id, "fair_rotation");
    }
  }

  for (const employee of employees || []) {
    const id = numericId(employee?.id);
    if (!id || seen.has(id)) continue;
    skipped.push(employee);
  }

  return {
    ordered,
    nextEmployeeId: ordered[0]?.id ?? null,
    reasonById,
    sourceById,
    fairnessById,
    fairnessLabelById: new Map([...fairnessById.entries()].map(([id, score]) => [id, fairnessLabel(score)])),
    paidContractByEmployeeId,
    skipped,
    canManuallyTrain(employeeId) {
      const id = numericId(employeeId);
      return Boolean(id && byId.has(id) && getFrom(eligibilityById, id)?.eligible === true && !pendingReceipt(trainReceipts, id));
    }
  };
}
