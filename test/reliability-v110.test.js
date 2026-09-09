import test from "node:test";
import assert from "node:assert/strict";
import { TrainingManagerController } from "../src/app/controller.js";
import { TornApiClient } from "../src/infra/torn-api.js";
import { DEFAULT_SETTINGS } from "../src/core/constants.js";

const NOW = 2_100_000_000;

function employee(id = 11) {
  return {
    id,
    name: `Employee ${id}`,
    joinedAt: NOW - 100_000,
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

function storageFake() {
  return {
    settings: { schemaVersion: 1, ...DEFAULT_SETTINGS },
    history: { schemaVersion: 1, eventsByNewsId: {}, unresolvedByNewsId: {}, newestTimestamp: 0 },
    payroll: { schemaVersion: 1, recordsByEmployeeId: {} },
    cache: { schemaVersion: 1, employees: [], trains: null, profile: null, lastUpdatedAt: null },
    async loadSettings() { return structuredClone(this.settings); },
    async saveSettings(value) { this.settings = structuredClone(value); return this.settings; },
    async loadHistory() { return structuredClone(this.history); },
    async saveHistory(value) { this.history = structuredClone(value); return this.history; },
    async loadPayroll() { return structuredClone(this.payroll); },
    async savePayroll(value) { this.payroll = structuredClone(value); return this.payroll; },
    async loadCache() { return structuredClone(this.cache); },
    async saveCache(value) { this.cache = { schemaVersion: 1, ...structuredClone(value) }; return this.cache; }
  };
}

function apiFake({ id = 11, newsQueue = [] } = {}) {
  const emp = employee(id);
  return {
    employees: [emp],
    trains: 2,
    newsQueue: newsQueue.map((value) => structuredClone(value)),
    calls: [],
    async getEmployees() { return structuredClone(this.employees); },
    async getProfile() { return { trains: this.trains }; },
    async getTrainingNewsSince(from, options = {}) {
      this.calls.push({ from, options: structuredClone(options) });
      return { news: this.newsQueue.length ? this.newsQueue.shift() : [], complete: true };
    },
    async rebuildTrainingNews() { return { news: [], complete: true }; }
  };
}

function controllerHarness({ newsQueue, trainResult = { status: "accepted" } } = {}) {
  const api = apiFake({ newsQueue });
  const storage = storageFake();
  const sleepCalls = [];
  const pageActions = {
    trainCalls: [],
    async submitTrain(id) { this.trainCalls.push(id); return structuredClone(trainResult); },
    async submitWageChange() { return { status: "submitted" }; },
    inspectTrainingEnvironment(id) {
      return { employeeId: id, exactTrainControlFound: true, rfcTokenPresent: true, authorization: "ApiKey should-never-leak" };
    }
  };
  const controller = new TrainingManagerController({
    api,
    storage,
    pageActions,
    sleep: async (ms) => { sleepCalls.push(ms); },
    nowSeconds: () => NOW
  });
  return { controller, api, storage, pageActions, sleepCalls };
}

test("accepted train verifies immediately when matching company news is already visible after preflight", async () => {
  const h = controllerHarness({ newsQueue: [[], [], [trainingNews(11)]] });
  await h.controller.initialize();
  const result = await h.controller.trainEmployee(11);
  assert.equal(result.status, "verified");
  assert.equal(h.sleepCalls.includes(31_000), false);
});

test("accepted train waits for Torn cache then uses cache-busted verification after preflight", async () => {
  const h = controllerHarness({ newsQueue: [[], [], [], [trainingNews(11)]] });
  const seen = [];
  h.controller.subscribe((state) => { if (state.action?.type === "train") seen.push(state.action.status); });
  await h.controller.initialize();
  const result = await h.controller.trainEmployee(11);
  assert.equal(result.status, "verified");
  assert.equal(seen.includes("accepted"), true);
  assert.equal(seen.includes("awaiting_verification"), true);
  assert.equal(h.sleepCalls.includes(31_000), true);
  assert.equal(h.api.calls.some(call => Number.isFinite(Number(call.options?.cacheBust))), true);
});

test("accepted but unconfirmed train becomes accepted_unverified and blocks duplicate retry", async () => {
  const h = controllerHarness({ newsQueue: [[], [], [], []] });
  await h.controller.initialize();
  const result = await h.controller.trainEmployee(11);
  assert.equal(result.status, "accepted_unverified");
  assert.equal(h.controller.getState().action.status, "accepted_unverified");
  await assert.rejects(() => h.controller.trainEmployee(11), /verification|unverified|duplicate|pending/i);
  assert.equal(h.pageActions.trainCalls.length, 1);
});

test("explicit Torn rejection performs preflight but never enters post-acceptance verification wait", async () => {
  const h = controllerHarness({ newsQueue: [[], []], trainResult: { status: "rejected", reason: "No trains available" } });
  await h.controller.initialize();
  const beforeNewsCalls = h.api.calls.length;
  const result = await h.controller.trainEmployee(11);
  assert.equal(result.status, "rejected");
  assert.match(result.reason, /No trains/i);
  assert.equal(h.api.calls.length, beforeNewsCalls + 1);
  assert.equal(h.sleepCalls.length, 0);
});

test("diagnostics include useful health data but recursively redact sensitive values", async () => {
  const h = controllerHarness({ newsQueue: [[]] });
  await h.controller.initialize();
  const diagnostics = h.controller.getDiagnostics();
  assert.equal(diagnostics.controller.employeeCount, 1);
  assert.equal(diagnostics.controller.nextEmployeeId, 11);
  assert.equal(diagnostics.page.rfcTokenPresent, true);
  const serialized = JSON.stringify(diagnostics);
  assert.equal(serialized.includes("ApiKey should-never-leak"), false);
  assert.equal(serialized.includes("authorization"), true);
  assert.equal(serialized.includes("[redacted]"), true);
});

test("training news cacheBust adds a unique timestamp query parameter", async () => {
  const urls = [];
  const transport = {
    async requestJson({ url }) {
      urls.push(url);
      return { news: [], _metadata: { links: { next: null } } };
    }
  };
  const api = new TornApiClient({ transport, apiKey: "safe-test-key", nowSeconds: () => NOW });
  await api.getTrainingNewsSince(123, { cacheBust: 987654321 });
  const url = new URL(urls[0]);
  assert.equal(url.searchParams.get("timestamp"), "987654321");
});