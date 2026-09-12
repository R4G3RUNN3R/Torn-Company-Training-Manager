import test from "node:test";
import assert from "node:assert/strict";
import { buildTrainingRecommendation } from "../src/core/recommendation.js";
import { createPaidContract, emptyPaidState } from "../src/core/paid-contracts.js";
import { emptyOverrideState, setPriorityOnce, createSkip } from "../src/core/overrides.js";
import { emptyFairnessState, recordFairnessTrain } from "../src/core/fairness.js";

function employee(id, joinedAt = 100) {
  return { id, name: `E${id}`, joinedAt };
}
function eligible(ids) {
  return new Map(ids.map((id) => [id, { eligible: true }]));
}
function history(entries = {}) {
  return new Map(Object.entries(entries).map(([id, value]) => [Number(id), value]));
}

test("recommendation precedence is paid then Priority Once then normal rotation", () => {
  const employees = [employee(1), employee(2), employee(3)];
  let paid = createPaidContract(emptyPaidState(), { employeeId: 1, employeeName: "E1", trainsPurchased: 5, createdAt: 100 });
  let overrides = setPriorityOnce(emptyOverrideState(), 2, 120);
  const result = buildTrainingRecommendation({
    employees,
    eligibilityById: eligible([1, 2, 3]),
    trainingById: history(),
    settings: { prioritizeNeverTrained: true, rotationMode: "fair" },
    paidState: paid,
    overrideState: overrides,
    fairnessState: emptyFairnessState(1),
    nowSeconds: 200
  });
  assert.deepEqual(result.ordered.map((row) => row.id), [1, 2, 3]);
  assert.equal(result.nextEmployeeId, 1);
  assert.equal(result.sourceById.get(1), "paid");
  assert.equal(result.sourceById.get(2), "priority_once");
});

test("ineligible paid employee falls through without losing paid queue state", () => {
  const employees = [employee(1), employee(2)];
  const paid = createPaidContract(emptyPaidState(), { employeeId: 1, employeeName: "E1", trainsPurchased: 5, createdAt: 100 });
  const eligibilityById = new Map([[1, { eligible: false }], [2, { eligible: true }]]);
  const result = buildTrainingRecommendation({ employees, eligibilityById, trainingById: history(), settings: { rotationMode: "fair" }, paidState: paid, overrideState: emptyOverrideState(), fairnessState: emptyFairnessState(1), nowSeconds: 200 });
  assert.equal(result.nextEmployeeId, 2);
  assert.equal(result.ordered.some((row) => row.id === 1), false);
  assert.equal(result.reasonById.get(1), "ineligible");
});

test("pending verification and skip remove employees from recommendation", () => {
  const employees = [employee(1), employee(2), employee(3)];
  let overrides = createSkip(emptyOverrideState(), 2, { mode: "manual", createdAt: 100 });
  const result = buildTrainingRecommendation({
    employees,
    eligibilityById: eligible([1, 2, 3]),
    trainingById: history(),
    settings: { rotationMode: "fair", prioritizeNeverTrained: true },
    paidState: emptyPaidState(),
    overrideState: overrides,
    fairnessState: emptyFairnessState(1),
    trainReceipts: { receiptsByEmployeeId: { "1": { status: "accepted_unverified" } } },
    nowSeconds: 200
  });
  assert.equal(result.nextEmployeeId, 3);
  assert.equal(result.reasonById.get(1), "pending_train_verification");
  assert.equal(result.reasonById.get(2), "skipped");
});

test("balanced fairness orders the most behind eligible employee first", () => {
  const employees = [employee(1), employee(2), employee(3)];
  let fairness = emptyFairnessState(1);
  fairness = recordFairnessTrain(fairness, { timestamp: 100, eligibleEmployeeIds: [1, 2, 3], trainedEmployeeId: 1 });
  fairness = recordFairnessTrain(fairness, { timestamp: 110, eligibleEmployeeIds: [1, 2, 3], trainedEmployeeId: 1 });
  fairness = recordFairnessTrain(fairness, { timestamp: 120, eligibleEmployeeIds: [1, 2, 3], trainedEmployeeId: 2 });
  const result = buildTrainingRecommendation({
    employees,
    eligibilityById: eligible([1, 2, 3]),
    trainingById: history(),
    settings: { rotationMode: "balanced", fairnessWindowDays: 30, accrueDebtWhileIneligible: false },
    paidState: emptyPaidState(),
    overrideState: emptyOverrideState(),
    fairnessState: fairness,
    nowSeconds: 200
  });
  assert.equal(result.nextEmployeeId, 3);
  assert.equal(result.sourceById.get(3), "balanced_fairness");
  assert.ok(result.fairnessById.get(3) > result.fairnessById.get(2));
});

test("manual training remains allowed for any eligible non-recommended employee", () => {
  const employees = [employee(1), employee(2)];
  const result = buildTrainingRecommendation({ employees, eligibilityById: eligible([1, 2]), trainingById: history(), settings: { rotationMode: "fair" }, paidState: emptyPaidState(), overrideState: emptyOverrideState(), fairnessState: emptyFairnessState(1), nowSeconds: 200 });
  assert.equal(result.canManuallyTrain(2), true);
  assert.equal(result.canManuallyTrain(999), false);
});
