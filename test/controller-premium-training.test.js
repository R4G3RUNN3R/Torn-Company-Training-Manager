import test from "node:test";
import assert from "node:assert/strict";
import { TrainingManagerController } from "../src/app/controller.js";
import { DEFAULT_SETTINGS } from "../src/core/constants.js";
import { createPaidContract, emptyPaidState } from "../src/core/paid-contracts.js";
import { emptyFairnessState } from "../src/core/fairness.js";
import { emptyOverrideState } from "../src/core/overrides.js";

const NOW = 2_500_000_000;

function employee(id) {
  return { id, name: `E${id}`, joinedAt: NOW - 500_000, wage: 50_000, lastActionTimestamp: NOW - 60, addictionMagnitude: 0, rawAddictionEffectiveness: 0, lastActionRelative: "1 minute ago" };
}
function news(id, timestamp = NOW + 1) {
  return { id: `n-${id}-${timestamp}`, timestamp, text: `<a href="https://www.torn.com/profiles.php?XID=${id}">E${id}</a> has been trained by the director` };
}

function storageFake({ paid = emptyPaidState(), overrides = emptyOverrideState(), fairness = emptyFairnessState(NOW) } = {}) {
  return {
    settings: { schemaVersion: 1, ...DEFAULT_SETTINGS }, history: { schemaVersion: 1, eventsByNewsId: {}, unresolvedByNewsId: {}, newestTimestamp: 0 }, payroll: { schemaVersion: 1, recordsByEmployeeId: {} }, cache: { schemaVersion: 1, employees: [], trains: null, profile: null, lastUpdatedAt: null }, audit: { schemaVersion: 1, entries: [] }, trainReceipts: { schemaVersion: 1, receiptsByEmployeeId: {} }, paid, overrides, fairness,
    async loadSettings(){return structuredClone(this.settings)}, async saveSettings(v){this.settings=structuredClone(v);return this.settings},
    async loadHistory(){return structuredClone(this.history)}, async saveHistory(v){this.history=structuredClone(v);return this.history},
    async loadPayroll(){return structuredClone(this.payroll)}, async savePayroll(v){this.payroll=structuredClone(v);return this.payroll},
    async loadCache(){return structuredClone(this.cache)}, async saveCache(v){this.cache={schemaVersion:1,...structuredClone(v)};return this.cache},
    async loadAudit(){return structuredClone(this.audit)}, async appendAudit(){return structuredClone(this.audit)},
    async loadTrainReceipts(){return structuredClone(this.trainReceipts)}, async saveTrainReceipts(v){this.trainReceipts=structuredClone(v);return this.trainReceipts},
    async loadPaidContracts(){return structuredClone(this.paid)}, async savePaidContracts(v){this.paid=structuredClone(v);return this.paid},
    async loadFairness(){return structuredClone(this.fairness)}, async saveFairness(v){this.fairness=structuredClone(v);return this.fairness},
    async loadOverrides(){return structuredClone(this.overrides)}, async saveOverrides(v){this.overrides=structuredClone(v);return this.overrides}
  };
}

function harness({ paid, verification = true } = {}) {
  const storage = storageFake({ paid });
  const api = {
    employees: [employee(1), employee(2)], trains: 3, calls: 0,
    async getEmployees(){return structuredClone(this.employees)}, async getProfile(){return {trains:this.trains}},
    async getTrainingNewsSince(){ this.calls += 1; return { news: verification && this.calls >= 3 ? [news(1)] : [], complete:true }; },
    async rebuildTrainingNews(){return {news:[],complete:true}}
  };
  const pageActions = { async submitTrain(){return {status:"accepted"}}, async submitWageChange(){return {status:"submitted"}}, inspectTrainingEnvironment(){return {employeeRowFound:true,rfcTokenPresent:true}} };
  const controller = new TrainingManagerController({ api, storage, pageActions, nowSeconds:()=>NOW, sleep:async()=>{}, receiptSettleMs:0, attemptIdFactory:()=>"attempt" });
  return { controller, storage, api };
}

test("controller loads paid/fairness/override domains and recommends paid first", async () => {
  let paid = createPaidContract(emptyPaidState(), { employeeId:2, employeeName:"E2", trainsPurchased:4, createdAt:100 });
  const h = harness({ paid, verification:false });
  await h.controller.initialize();
  const state = h.controller.getState();
  assert.equal(state.paid.activeByEmployeeId["2"] != null, true);
  assert.equal(state.recommendation.nextEmployeeId, 2);
  assert.equal(state.recommendation.sourceById.get(2), "paid");
});

test("paid balance changes only after independent train verification", async () => {
  let paid = createPaidContract(emptyPaidState(), { employeeId:1, employeeName:"E1", trainsPurchased:1, createdAt:100 });
  const h = harness({ paid, verification:true });
  await h.controller.initialize();
  const result = await h.controller.trainEmployee(1, { countsTowardPaid:true });
  assert.equal(result.status, "verified");
  const contract = Object.values(h.storage.paid.contractsById)[0];
  assert.equal(contract.trainsRemaining, 0);
  assert.equal(contract.status, "completed");
  assert.equal(h.storage.fairness.opportunities.length, 1);
});

test("bonus train preserves paid balance but still records fairness", async () => {
  let paid = createPaidContract(emptyPaidState(), { employeeId:1, employeeName:"E1", trainsPurchased:2, createdAt:100 });
  const h = harness({ paid, verification:true });
  await h.controller.initialize();
  const result = await h.controller.trainEmployee(1, { countsTowardPaid:false });
  assert.equal(result.status, "verified");
  const contract = Object.values(h.storage.paid.contractsById)[0];
  assert.equal(contract.trainsRemaining, 2);
  assert.equal(h.storage.fairness.opportunities.length, 1);
});

test("Priority Once is consumed only after that employee receives a verified train", async () => {
  const h = harness({ paid:emptyPaidState(), verification:true });
  h.storage.overrides = { schemaVersion:1, priorityOnceEmployeeId:1, prioritySetAt:50, skipsByEmployeeId:{} };
  await h.controller.initialize();
  assert.equal(h.controller.getState().recommendation.sourceById.get(1), "priority_once");
  await h.controller.trainEmployee(1);
  assert.equal(h.storage.overrides.priorityOnceEmployeeId, null);
});
