import test from "node:test";
import assert from "node:assert/strict";
import { companyManagerHtml } from "../src/ui/company-manager.js";
import { TrainingManagerController } from "../src/app/controller.js";
import { DEFAULT_SETTINGS } from "../src/core/constants.js";

const NOW = 2_300_000_000;

function employee(id, joinedOffset) {
  return {
    id,
    name: `Employee ${id}`,
    joinedAt: NOW - joinedOffset,
    wage: 50_000,
    lastActionTimestamp: NOW - 60,
    addictionMagnitude: 0,
    rawAddictionEffectiveness: 0,
    lastActionRelative: "1 minute ago"
  };
}

function pendingReceipt(id) {
  return {
    employeeId: id,
    employeeName: `Employee ${id}`,
    attemptId: `attempt-${id}`,
    requestedAt: NOW - 30,
    acceptedAt: NOW - 29,
    trainsBefore: 2,
    historyNewestTimestampBefore: 0,
    status: "accepted_unverified"
  };
}

function managerState() {
  const employees = [employee(1, 500_000), employee(2, 400_000)];
  return {
    status: "ready",
    stale: false,
    trains: 2,
    lastUpdatedAt: NOW,
    error: null,
    action: null,
    settings: { maxAddiction: 3 },
    employees,
    eligibilityById: new Map(employees.map((item) => [item.id, { eligible: true, unverified: false, inactive: false, addictionViolation: false, reasons: [] }])),
    trainingById: new Map(employees.map((item) => [item.id, { totalTrains: 0, lastTrainTimestamp: null }])),
    rotation: { nextEmployeeId: 2, orderedEligible: [employees[1]], skipped: [employees[0]], reasonById: new Map([[1, "pending_train_verification"], [2, "never_trained"]]) },
    payroll: { recordsByEmployeeId: {} },
    trainReceipts: { schemaVersion: 1, receiptsByEmployeeId: { "1": pendingReceipt(1) } }
  };
}

test("pending train receipt shows a clear lock status and exposes no direct Train action", () => {
  const html = companyManagerHtml(managerState());
  const row = html.match(/<tr[^>]*>[\s\S]*?Employee 1[\s\S]*?<\/tr>/)?.[0] || "";
  assert.match(row, /VERIFYING/i);
  assert.doesNotMatch(row, /data-action="train"/i);
  assert.match(row, /data-action="employee-menu"/i);
});

test("preflight_changed and submission_unknown have explicit manager feedback", () => {
  const preflight = managerState();
  preflight.action = { type: "train", employeeId: 1, status: "preflight_changed", reason: "training_state_changed" };
  assert.match(companyManagerHtml(preflight), /changed.*before.*train|refresh.*recommend/i);

  const unknown = managerState();
  unknown.action = { type: "train", employeeId: 1, status: "submission_unknown", reason: "unknown result" };
  assert.match(companyManagerHtml(unknown), /outcome.*unknown|do not retry|blocked/i);
});

test("persistent pending receipt is excluded from next-train rotation", async () => {
  const employees = [employee(1, 500_000), employee(2, 400_000)];
  const storage = {
    settings: { schemaVersion: 1, ...DEFAULT_SETTINGS },
    history: { schemaVersion: 1, eventsByNewsId: {}, unresolvedByNewsId: {}, newestTimestamp: 0 },
    payroll: { schemaVersion: 1, recordsByEmployeeId: {} },
    cache: { schemaVersion: 1, employees: [], trains: null, profile: null, lastUpdatedAt: null },
    trainReceipts: { schemaVersion: 1, receiptsByEmployeeId: { "1": pendingReceipt(1) } },
    async loadSettings() { return structuredClone(this.settings); },
    async saveSettings(value) { this.settings = structuredClone(value); return this.settings; },
    async loadHistory() { return structuredClone(this.history); },
    async saveHistory(value) { this.history = structuredClone(value); return this.history; },
    async loadPayroll() { return structuredClone(this.payroll); },
    async savePayroll(value) { this.payroll = structuredClone(value); return this.payroll; },
    async loadCache() { return structuredClone(this.cache); },
    async saveCache(value) { this.cache = { schemaVersion: 1, ...structuredClone(value) }; return this.cache; },
    async loadTrainReceipts() { return structuredClone(this.trainReceipts); },
    async saveTrainReceipts(value) { this.trainReceipts = structuredClone(value); return this.trainReceipts; }
  };
  const api = {
    async getEmployees() { return structuredClone(employees); },
    async getProfile() { return { trains: 2 }; },
    async getTrainingNewsSince() { return { news: [], complete: true }; },
    async rebuildTrainingNews() { return { news: [], complete: true }; }
  };
  const pageActions = {
    async submitTrain() { throw new Error("must not submit in this test"); },
    async submitWageChange() { return { status: "submitted" }; },
    inspectTrainingEnvironment() { return { employeeRowFound: true, rfcTokenPresent: true }; }
  };
  const controller = new TrainingManagerController({ api, storage, pageActions, nowSeconds: () => NOW, sleep: async () => {} });

  await controller.initialize();
  const state = controller.getState();
  assert.equal(state.rotation.nextEmployeeId, 2);
  assert.equal(state.rotation.orderedEligible.some((item) => Number(item.id) === 1), false);
  assert.equal(state.rotation.skipped.some((item) => Number(item.id) === 1), true);
  assert.equal(state.rotation.reasonById.get(1), "pending_train_verification");
});
