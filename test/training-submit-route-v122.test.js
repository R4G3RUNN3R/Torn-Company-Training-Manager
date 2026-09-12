import test from "node:test";
import assert from "node:assert/strict";
import { CompanyPageActions } from "../src/infra/company-page-actions.js";
import { TrainingManagerController } from "../src/app/controller.js";
import { DEFAULT_SETTINGS } from "../src/core/constants.js";

const NOW = 2_100_100_000;

function currentRouteHarness() {
  const row = { querySelectorAll() { return []; } };
  const document = {
    location: { origin: "https://www.torn.com", href: "https://www.torn.com/companies.php#/option=employees" },
    cookie: "",
    querySelector(selector) {
      if (selector.includes('li[data-user="4465537"]')) return row;
      if (selector === 'input[name="rfcv"]') return { value: "abc123def456" };
      return null;
    },
    querySelectorAll() { return []; }
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, async text() { return JSON.stringify({ success: true }); } };
  };
  return { document, fetchImpl, calls };
}

test("current Torn hash-only Company Employees route can submit an exact training POST", async () => {
  const h = currentRouteHarness();
  const actions = new CompanyPageActions(h);

  const result = await actions.submitTrain(4465537);

  assert.equal(result.status, "accepted");
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.body.get("step"), "trainemp2");
  assert.equal(h.calls[0].options.body.get("ID"), "4465537");
});

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

function storageFake() {
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

function apiFake() {
  return {
    async getEmployees() { return [employee()]; },
    async getProfile() { return { trains: 2 }; },
    async getTrainingNewsSince() { return { news: [], complete: true }; },
    async rebuildTrainingNews() { return { news: [], complete: true }; }
  };
}

test("pre-submit unsafe DOM failure clears the reserved receipt instead of creating an unknown-outcome lock", async () => {
  const storage = storageFake();
  const pageActions = {
    async submitTrain() { return { status: "unsafe_dom", reason: "not_company_management_page" }; },
    async submitWageChange() { return { status: "submitted" }; },
    inspectTrainingEnvironment(id) { return { employeeId: id, employeeRowFound: true, rfcTokenPresent: true }; }
  };
  const controller = new TrainingManagerController({
    api: apiFake(),
    storage,
    pageActions,
    sleep: async () => {},
    nowSeconds: () => NOW,
    receiptSettleMs: 0
  });
  await controller.initialize();

  const result = await controller.trainEmployee(11);

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "not_company_management_page");
  assert.equal(storage.trainReceipts.receiptsByEmployeeId["11"], undefined);
  assert.equal(controller.getState().action.status, "failed");
});
