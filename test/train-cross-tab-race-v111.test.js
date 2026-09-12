import test from "node:test";
import assert from "node:assert/strict";
import { TrainingManagerController } from "../src/app/controller.js";
import { DEFAULT_SETTINGS } from "../src/core/constants.js";

const NOW = 2_400_000_000;
const EMPLOYEE_ID = 77;

function employee() {
  return {
    id: EMPLOYEE_ID,
    name: "Race Target",
    joinedAt: NOW - 400_000,
    wage: 50_000,
    lastActionTimestamp: NOW - 60,
    addictionMagnitude: 0,
    rawAddictionEffectiveness: 0,
    lastActionRelative: "1 minute ago"
  };
}

function racingStorage() {
  let receiptSaveCount = 0;
  let releaseFirstSave;
  const firstSaveBarrier = new Promise((resolve) => { releaseFirstSave = resolve; });
  return {
    settings: { schemaVersion: 1, ...DEFAULT_SETTINGS },
    history: { schemaVersion: 1, eventsByNewsId: {}, unresolvedByNewsId: {}, newestTimestamp: 0 },
    payroll: { schemaVersion: 1, recordsByEmployeeId: {} },
    cache: { schemaVersion: 1, employees: [], trains: null, profile: null, lastUpdatedAt: null },
    trainReceipts: { schemaVersion: 1, receiptsByEmployeeId: {} },
    async loadSettings() { return structuredClone(this.settings); },
    async saveSettings(value) { this.settings = structuredClone(value); return this.settings; },
    async loadHistory() { return structuredClone(this.history); },
    async saveHistory(value) { this.history = structuredClone(value); return this.history; },
    async loadPayroll() { return structuredClone(this.payroll); },
    async savePayroll(value) { this.payroll = structuredClone(value); return this.payroll; },
    async loadCache() { return structuredClone(this.cache); },
    async saveCache(value) { this.cache = { schemaVersion: 1, ...structuredClone(value) }; return this.cache; },
    async loadTrainReceipts() { return structuredClone(this.trainReceipts); },
    async saveTrainReceipts(value) {
      receiptSaveCount += 1;
      const mine = structuredClone(value);
      this.trainReceipts = mine;
      if (receiptSaveCount === 1) {
        await firstSaveBarrier;
      } else if (receiptSaveCount === 2) {
        releaseFirstSave();
      }
      return mine;
    }
  };
}

function apiFake() {
  return {
    async getEmployees() { return [employee()]; },
    async getProfile() { return { trains: 2 }; },
    async getTrainingNewsSince() { return { news: [], complete: true }; },
    async rebuildTrainingNews() { return { news: [], complete: true }; }
  };
}

function actionsFake(sharedPostCalls) {
  return {
    async submitTrain(id) {
      sharedPostCalls.push(id);
      return { status: "accepted" };
    },
    async submitWageChange() { return { status: "submitted" }; },
    inspectTrainingEnvironment() { return { employeeRowFound: true, rfcTokenPresent: true }; }
  };
}

function controller({ storage, postCalls, attemptId }) {
  return new TrainingManagerController({
    api: apiFake(),
    storage,
    pageActions: actionsFake(postCalls),
    nowSeconds: () => NOW,
    sleep: async () => {},
    attemptIdFactory: () => attemptId
  });
}

test("simultaneous same-employee train attempts from two controllers allow only one Torn POST", async () => {
  const storage = racingStorage();
  const postCalls = [];
  const first = controller({ storage, postCalls, attemptId: "tab-A" });
  const second = controller({ storage, postCalls, attemptId: "tab-B" });
  await Promise.all([first.initialize(), second.initialize()]);

  const results = await Promise.allSettled([
    first.trainEmployee(EMPLOYEE_ID),
    second.trainEmployee(EMPLOYEE_ID)
  ]);

  assert.equal(postCalls.length, 1);
  assert.equal(results.some((result) => result.status === "rejected" && /another|duplicate|pending|receipt/i.test(String(result.reason?.message || result.reason))), true);
  assert.equal(results.some((result) => result.status === "fulfilled" && result.value?.status === "accepted_unverified"), true);
});