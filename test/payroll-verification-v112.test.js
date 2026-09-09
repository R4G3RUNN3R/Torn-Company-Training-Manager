import test from "node:test";
import assert from "node:assert/strict";
import { TrainingManagerController } from "../src/app/controller.js";
import { TornApiClient } from "../src/infra/torn-api.js";
import { DEFAULT_SETTINGS } from "../src/core/constants.js";

const NOW = 2_200_000_000;
const EMPLOYEE_ID = 4298323;

function employee(wage) {
  return {
    id: EMPLOYEE_ID,
    name: "FarQue2",
    joinedAt: NOW - 100_000,
    wage,
    lastActionTimestamp: NOW - 90_000,
    addictionMagnitude: 0,
    rawAddictionEffectiveness: 0,
    lastActionRelative: "1 day ago"
  };
}

function storageFake() {
  return {
    settings: { schemaVersion: 1, ...DEFAULT_SETTINGS },
    history: { schemaVersion: 1, eventsByNewsId: {}, unresolvedByNewsId: {}, newestTimestamp: 0 },
    payroll: { schemaVersion: 1, recordsByEmployeeId: {} },
    cache: { schemaVersion: 1, employees: [], trains: null, profile: null, lastUpdatedAt: null },
    audit: { schemaVersion: 1, entries: [] },
    async loadSettings() { return structuredClone(this.settings); },
    async saveSettings(value) { this.settings = structuredClone(value); return this.settings; },
    async loadHistory() { return structuredClone(this.history); },
    async saveHistory(value) { this.history = structuredClone(value); return this.history; },
    async loadPayroll() { return structuredClone(this.payroll); },
    async savePayroll(value) { this.payroll = structuredClone(value); return this.payroll; },
    async loadCache() { return structuredClone(this.cache); },
    async saveCache(value) { this.cache = { schemaVersion: 1, ...structuredClone(value) }; return this.cache; },
    async loadAudit() { return structuredClone(this.audit); },
    async appendAudit(entry) { this.audit.entries.push(structuredClone(entry)); return structuredClone(this.audit); }
  };
}

test("Dock Pay uses cache-busted employee reads before declaring wage verification unverified", async () => {
  const storage = storageFake();
  let backendWage = 50_000;
  const employeeCalls = [];
  const sleepCalls = [];
  const api = {
    async getEmployees(options = {}) {
      employeeCalls.push(structuredClone(options));
      const wage = options.cacheBust == null ? 50_000 : backendWage;
      return [employee(wage)];
    },
    async getProfile() { return { trains: 1 }; },
    async getTrainingNewsSince() { return { news: [], complete: true }; }
  };
  const pageActions = {
    async submitWageChange({ targetWage }) {
      backendWage = targetWage;
      return { status: "submitted" };
    },
    inspectTrainingEnvironment() { return { employeeRowFound: true, rfcTokenPresent: true }; }
  };
  const controller = new TrainingManagerController({
    api,
    storage,
    pageActions,
    sleep: async (ms) => { sleepCalls.push(ms); },
    nowSeconds: () => NOW
  });

  await controller.initialize();
  employeeCalls.length = 0;
  sleepCalls.length = 0;

  const result = await controller.dockPay(EMPLOYEE_ID, 0);

  assert.equal(result.status, "verified");
  assert.equal(employeeCalls.some((options) => options.cacheBust === NOW), true);
  assert.equal(sleepCalls.includes(31_000), false);
});

test("employees API cacheBust adds a timestamp query parameter for payroll verification", async () => {
  const urls = [];
  const transport = {
    async requestJson({ url }) {
      urls.push(url);
      return { employees: [] };
    }
  };
  const api = new TornApiClient({ transport, apiKey: "safe-test-key", nowSeconds: () => NOW });

  await api.getEmployees({ cacheBust: 987654321 });

  const url = new URL(urls[0]);
  assert.equal(url.searchParams.get("timestamp"), "987654321");
});
