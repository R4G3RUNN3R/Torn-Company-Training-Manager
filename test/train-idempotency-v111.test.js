import test from "node:test";
import assert from "node:assert/strict";
import { TrainingManagerController } from "../src/app/controller.js";
import { DEFAULT_SETTINGS } from "../src/core/constants.js";

const NOW = 2_100_100_000;

function employee(id = 11) {
  return {
    id,
    name: `Employee ${id}`,
    joinedAt: NOW - 400_000,
    wage: 50_000,
    lastActionTimestamp: NOW - 60,
    addictionMagnitude: 0,
    rawAddictionEffectiveness: 0,
    lastActionRelative: "1 minute ago"
  };
}

function trainingNews(id, ts = NOW + 1) {
  return {
    id: `news-${id}-${ts}`,
    timestamp: ts,
    text: `<a href="https://www.torn.com/profiles.php?XID=${id}">Employee ${id}</a> has been trained by the director`
  };
}

function sharedStorage() {
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
    async saveTrainReceipts(value) { this.trainReceipts = structuredClone(value); return this.trainReceipts; }
  };
}

function apiFake(id = 11) {
  return {
    employees: [employee(id)],
    trains: 2,
    news: [],
    calls: [],
    async getEmployees() {
      this.calls.push({ type: "employees" });
      return structuredClone(this.employees);
    },
    async getProfile() {
      this.calls.push({ type: "profile" });
      return { trains: this.trains };
    },
    async getTrainingNewsSince(from, options = {}) {
      this.calls.push({ type: "news", from, options: structuredClone(options) });
      return { news: structuredClone(this.news), complete: true };
    },
    async rebuildTrainingNews() { return { news: [], complete: true }; }
  };
}

function pageActionsFake(initialResult = { status: "accepted" }) {
  return {
    trainCalls: [],
    trainResult: structuredClone(initialResult),
    async submitTrain(id) {
      this.trainCalls.push(id);
      return structuredClone(this.trainResult);
    },
    async submitWageChange() { return { status: "submitted" }; },
    inspectTrainingEnvironment(id) {
      return { employeeId: id, employeeRowFound: true, exactTrainControlFound: true, rfcTokenPresent: true };
    }
  };
}

function makeController({ api, storage, pageActions } = {}) {
  const resolvedApi = api || apiFake();
  const resolvedStorage = storage || sharedStorage();
  const resolvedPageActions = pageActions || pageActionsFake();
  const sleepCalls = [];
  const controller = new TrainingManagerController({
    api: resolvedApi,
    storage: resolvedStorage,
    pageActions: resolvedPageActions,
    sleep: async (ms) => { sleepCalls.push(ms); },
    nowSeconds: () => NOW
  });
  return { controller, api: resolvedApi, storage: resolvedStorage, pageActions: resolvedPageActions, sleepCalls };
}

test("accepted-unverified train remains blocked after a successful refresh", async () => {
  const h = makeController();
  await h.controller.initialize();

  const first = await h.controller.trainEmployee(11);
  assert.equal(first.status, "accepted_unverified");
  assert.equal(h.pageActions.trainCalls.length, 1);

  await h.controller.refresh();

  await assert.rejects(() => h.controller.trainEmployee(11), /pending|verification|unverified/i);
  assert.equal(h.pageActions.trainCalls.length, 1);
});

test("accepted-unverified train receipt survives a controller reload", async () => {
  const storage = sharedStorage();
  const api = apiFake();
  const firstActions = pageActionsFake();
  const first = makeController({ api, storage, pageActions: firstActions });
  await first.controller.initialize();

  const result = await first.controller.trainEmployee(11);
  assert.equal(result.status, "accepted_unverified");
  assert.ok(storage.trainReceipts.receiptsByEmployeeId["11"]);

  const secondActions = pageActionsFake();
  const second = makeController({ api, storage, pageActions: secondActions });
  await second.controller.initialize();

  await assert.rejects(() => second.controller.trainEmployee(11), /pending|verification|unverified/i);
  assert.equal(secondActions.trainCalls.length, 0);
});

test("a second already-open controller reloads the persistent receipt before writing", async () => {
  const storage = sharedStorage();
  const api = apiFake();
  const first = makeController({ api, storage, pageActions: pageActionsFake() });
  const secondActions = pageActionsFake();
  const second = makeController({ api, storage, pageActions: secondActions });
  await first.controller.initialize();
  await second.controller.initialize();

  const result = await first.controller.trainEmployee(11);
  assert.equal(result.status, "accepted_unverified");

  await assert.rejects(() => second.controller.trainEmployee(11), /pending|verification|unverified/i);
  assert.equal(secondActions.trainCalls.length, 0);
});

test("matching Company News reconciles and clears a persisted pending receipt", async () => {
  const storage = sharedStorage();
  storage.trainReceipts.receiptsByEmployeeId["11"] = {
    employeeId: 11,
    employeeName: "Employee 11",
    requestedAt: NOW - 40,
    acceptedAt: NOW - 39,
    trainsBefore: 2,
    historyNewestTimestampBefore: NOW - 100,
    status: "accepted_unverified"
  };
  const api = apiFake();
  api.news = [trainingNews(11, NOW - 20)];
  const h = makeController({ api, storage, pageActions: pageActionsFake() });

  await h.controller.initialize();

  assert.equal(storage.trainReceipts.receiptsByEmployeeId["11"], undefined);
});

test("fresh preflight aborts when another trainer added Company News since the manager snapshot", async () => {
  const h = makeController();
  await h.controller.initialize();
  h.api.news = [trainingNews(11, NOW + 5)];

  const result = await h.controller.trainEmployee(11);

  assert.equal(result.status, "preflight_changed");
  assert.match(result.reason, /training_state_changed/i);
  assert.equal(h.pageActions.trainCalls.length, 0);
});

test("fresh preflight aborts when available train count changed outside the manager", async () => {
  const h = makeController();
  await h.controller.initialize();
  h.api.trains = 1;

  const result = await h.controller.trainEmployee(11);

  assert.equal(result.status, "preflight_changed");
  assert.equal(h.controller.getState().trains, 1);
  assert.equal(h.pageActions.trainCalls.length, 0);
});

test("explicit Torn rejection does not leave a duplicate-blocking receipt", async () => {
  const storage = sharedStorage();
  const actions = pageActionsFake({ status: "rejected", reason: "No trains available" });
  const h = makeController({ storage, pageActions: actions });
  await h.controller.initialize();

  const rejected = await h.controller.trainEmployee(11);
  assert.equal(rejected.status, "rejected");
  assert.equal(storage.trainReceipts.receiptsByEmployeeId["11"], undefined);

  actions.trainResult = { status: "accepted" };
  h.api.trains = 2;
  const retry = await h.controller.trainEmployee(11);
  assert.equal(retry.status, "accepted_unverified");
  assert.equal(actions.trainCalls.length, 2);
});