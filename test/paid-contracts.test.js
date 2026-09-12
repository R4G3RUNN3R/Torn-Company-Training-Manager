import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyPaidState,
  createPaidContract,
  amendPaidContract,
  syncPaidEligibility,
  recordVerifiedPaidTrain,
  reorderPaidQueue,
  pausePaidContract,
  resumePaidContract,
  closePaidContract
} from "../src/core/paid-contracts.js";

test("paid contracts are FIFO by default and allow explicit reorder", () => {
  let state = emptyPaidState();
  state = createPaidContract(state, { employeeId: 1, employeeName: "Alice", trainsPurchased: 5, createdAt: 100 });
  state = createPaidContract(state, { employeeId: 2, employeeName: "Bob", trainsPurchased: 3, createdAt: 200 });
  assert.deepEqual(state.queue, [state.activeByEmployeeId["1"], state.activeByEmployeeId["2"]]);
  state = reorderPaidQueue(state, [state.activeByEmployeeId["2"], state.activeByEmployeeId["1"]]);
  assert.deepEqual(state.queue, [state.activeByEmployeeId["2"], state.activeByEmployeeId["1"]]);
});

test("additional purchase amends the active contract instead of creating a second one", () => {
  let state = createPaidContract(emptyPaidState(), { employeeId: 7, employeeName: "Alice", trainsPurchased: 5, createdAt: 100 });
  const id = state.activeByEmployeeId["7"];
  state = amendPaidContract(state, 7, { addTrains: 4, totalPaid: 9000000, note: "top-up" }, 200);
  assert.equal(state.activeByEmployeeId["7"], id);
  assert.equal(state.contractsById[id].trainsPurchased, 9);
  assert.equal(state.contractsById[id].trainsRemaining, 9);
  assert.equal(state.contractsById[id].totalPaid, 9000000);
});

test("ineligible paid employee auto-pauses and resumes without losing queue position", () => {
  let state = createPaidContract(emptyPaidState(), { employeeId: 7, employeeName: "Alice", trainsPurchased: 2, createdAt: 100 });
  const id = state.activeByEmployeeId["7"];
  state = syncPaidEligibility(state, new Map([[7, { eligible: false }]]), 300);
  assert.equal(state.contractsById[id].status, "auto-paused");
  assert.deepEqual(state.queue, [id]);
  state = syncPaidEligibility(state, new Map([[7, { eligible: true }]]), 400);
  assert.equal(state.contractsById[id].status, "active");
  assert.deepEqual(state.queue, [id]);
});

test("director can manually pause and resume without losing queue position or balance", () => {
  let state = createPaidContract(emptyPaidState(), { employeeId: 7, employeeName: "Alice", trainsPurchased: 2, createdAt: 100 });
  const id = state.activeByEmployeeId["7"];
  state = pausePaidContract(state, 7, { timestamp: 200, reason: "director" });
  assert.equal(state.contractsById[id].status, "manually-paused");
  assert.equal(state.contractsById[id].trainsRemaining, 2);
  assert.deepEqual(state.queue, [id]);
  state = resumePaidContract(state, 7, { timestamp: 300 });
  assert.equal(state.contractsById[id].status, "active");
  assert.equal(state.contractsById[id].trainsRemaining, 2);
  assert.deepEqual(state.queue, [id]);
});

test("verified paid train decrements remaining and completes at zero", () => {
  let state = createPaidContract(emptyPaidState(), { employeeId: 7, employeeName: "Alice", trainsPurchased: 1, createdAt: 100 });
  const id = state.activeByEmployeeId["7"];
  state = recordVerifiedPaidTrain(state, 7, { timestamp: 200, countsTowardPaid: true });
  assert.equal(state.contractsById[id].trainsRemaining, 0);
  assert.equal(state.contractsById[id].trainsDelivered, 1);
  assert.equal(state.contractsById[id].status, "completed");
  assert.equal(state.activeByEmployeeId["7"], undefined);
});

test("bonus train does not reduce paid balance", () => {
  let state = createPaidContract(emptyPaidState(), { employeeId: 7, employeeName: "Alice", trainsPurchased: 2, createdAt: 100 });
  const id = state.activeByEmployeeId["7"];
  state = recordVerifiedPaidTrain(state, 7, { timestamp: 200, countsTowardPaid: false });
  assert.equal(state.contractsById[id].trainsRemaining, 2);
  assert.equal(state.contractsById[id].trainsDelivered, 0);
});

test("one employee cannot have two active paid commitments", () => {
  let state = createPaidContract(emptyPaidState(), { employeeId: 7, employeeName: "Alice", trainsPurchased: 2, createdAt: 100 });
  assert.throws(() => createPaidContract(state, { employeeId: 7, employeeName: "Alice", trainsPurchased: 2, createdAt: 200 }), /active paid agreement/i);
});

test("closing a paid contract records explicit terminal outcome", () => {
  let state = createPaidContract(emptyPaidState(), { employeeId: 7, employeeName: "Alice", trainsPurchased: 2, createdAt: 100 });
  const id = state.activeByEmployeeId["7"];
  state = closePaidContract(state, 7, { outcome: "forfeited", timestamp: 300, reason: "prolonged_non_compliance" });
  assert.equal(state.contractsById[id].status, "forfeited");
  assert.equal(state.contractsById[id].closedReason, "prolonged_non_compliance");
  assert.equal(state.activeByEmployeeId["7"], undefined);
});
