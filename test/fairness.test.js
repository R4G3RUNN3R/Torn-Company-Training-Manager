import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyFairnessState,
  recordFairnessTrain,
  fairnessScores
} from "../src/core/fairness.js";

test("balanced fairness assigns equal expected share to eligible employees", () => {
  let state = emptyFairnessState(100);
  state = recordFairnessTrain(state, {
    timestamp: 200,
    eligibleEmployeeIds: [1, 2],
    trainedEmployeeId: 1
  });
  const scores = fairnessScores(state, { nowSeconds: 300, windowDays: 30 });
  assert.equal(scores.get(1), -0.5);
  assert.equal(scores.get(2), 0.5);
});

test("ineligible employee does not accrue expected share by default", () => {
  let state = emptyFairnessState(100);
  state = recordFairnessTrain(state, {
    timestamp: 200,
    eligibleEmployeeIds: [1],
    trainedEmployeeId: 1,
    allEmployeeIds: [1, 2]
  });
  const scores = fairnessScores(state, { nowSeconds: 300, windowDays: 30, accrueDebtWhileIneligible: false });
  assert.equal(scores.get(1), 0);
  assert.equal(scores.get(2) ?? 0, 0);
});

test("director can opt in to ineligible debt accrual", () => {
  let state = emptyFairnessState(100);
  state = recordFairnessTrain(state, {
    timestamp: 200,
    eligibleEmployeeIds: [1],
    trainedEmployeeId: 1,
    allEmployeeIds: [1, 2]
  });
  const scores = fairnessScores(state, { nowSeconds: 300, windowDays: 30, accrueDebtWhileIneligible: true });
  assert.equal(scores.get(1), -0.5);
  assert.equal(scores.get(2), 0.5);
});

test("rolling window ignores old fairness opportunities", () => {
  let state = emptyFairnessState(0);
  state = recordFairnessTrain(state, { timestamp: 100, eligibleEmployeeIds: [1, 2], trainedEmployeeId: 1 });
  state = recordFairnessTrain(state, { timestamp: 40 * 86400, eligibleEmployeeIds: [1, 2], trainedEmployeeId: 2 });
  const scores = fairnessScores(state, { nowSeconds: 40 * 86400, windowDays: 30 });
  assert.equal(scores.get(1), 0.5);
  assert.equal(scores.get(2), -0.5);
});

test("fairness state exposes trustworthy tracking start rather than inventing history", () => {
  const state = emptyFairnessState(1234);
  assert.equal(state.trackingStartedAt, 1234);
  assert.deepEqual(state.opportunities, []);
});
