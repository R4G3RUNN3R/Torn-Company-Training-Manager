import test from "node:test";
import assert from "node:assert/strict";
import { TrainingManagerController } from "../src/app/controller.js";
import { DEFAULT_SETTINGS } from "../src/core/constants.js";
import { appendAuditEntry } from "../src/core/audit.js";

const NOW = 2_200_000_000;

function emp(id, { inactive = false, wage = 50_000 } = {}) {
  return {
    id,
    name: `E${id}`,
    joinedAt: NOW - 100_000,
    wage,
    lastActionTimestamp: NOW - (inactive ? 90_000 : 60),
    addictionMagnitude: 0,
    rawAddictionEffectiveness: 0,
    lastActionRelative: inactive ? "1 day ago" : "1 minute ago"
  };
}

function trainingNews(id) {
  return {
    id: `train-${id}`,
    timestamp: NOW + 1,
    text: `<a href="https://www.torn.com/profiles.php?XID=${id}">E${id}</a> has been trained by the director`
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
    async appendAudit(entry) { this.audit = appendAuditEntry(this.audit, entry); return structuredClone(this.audit); },
    async clearAudit() { this.audit = { schemaVersion: 1, entries: [] }; return structuredClone(this.audit); }
  };
}

function harness({ employee = emp(1), trains = 2 } = {}) {
  const storage = storageFake();
  const api = {
    employees: [structuredClone(employee)],
    trains,
    news: [],
    fail: false,
    async getEmployees() { if (this.fail) throw new Error("api down"); return structuredClone(this.employees); },
    async getProfile() { if (this.fail) throw new Error("api down"); return { trains: this.trains }; },
    async getTrainingNewsSince() { if (this.fail) throw new Error("api down"); return { news: structuredClone(this.news), complete: true }; },
    async rebuildTrainingNews() { if (this.fail) throw new Error("api down"); return { news: structuredClone(this.news), complete: true }; }
  };
  const pageActions = {
    async submitTrain(id) { api.news = [trainingNews(id)]; api.trains -= 1; return { status: "accepted", authorization: "secret" }; },
    async submitWageChange({ employeeId, targetWage }) {
      const target = api.employees.find(e => Number(e.id) === Number(employeeId));
      target.wage = targetWage;
      return { status: "submitted" };
    },
    inspectTrainingEnvironment(id) { return { employeeId: id, exactTrainControlFound: true, rfcTokenPresent: true }; }
  };
  const controller = new TrainingManagerController({ api, storage, pageActions, sleep: async () => {}, nowSeconds: () => NOW });
  return { controller, storage, api, pageActions };
}

function phases(storage, type) {
  return storage.audit.entries.filter(entry => entry.type === type).map(entry => entry.phase);
}

test("verified train writes preflight requested accepted and verified audit entries", async () => {
  const h = harness();
  await h.controller.initialize();
  const result = await h.controller.trainEmployee(1);
  assert.equal(result.status, "verified");
  assert.deepEqual(phases(h.storage, "train"), ["preflight_started", "preflight_ok", "requested", "accepted", "verified"]);
  const serialized = JSON.stringify(h.storage.audit);
  assert.equal(serialized.includes("authorization"), false);
  assert.equal(serialized.includes("secret"), false);
});

test("pay dock and restore write requested and verified audit entries", async () => {
  const h = harness({ employee: emp(2, { inactive: true, wage: 50_000 }) });
  await h.controller.initialize();
  const dock = await h.controller.dockPay(2, 10_000);
  assert.equal(dock.status, "verified");
  assert.deepEqual(phases(h.storage, "dock"), ["requested", "verified"]);

  h.api.employees[0].lastActionTimestamp = NOW - 60;
  h.api.employees[0].lastActionRelative = "1 minute ago";
  await h.controller.refresh();
  const restore = await h.controller.restorePay(2);
  assert.equal(restore.status, "verified");
  assert.deepEqual(phases(h.storage, "restore"), ["requested", "verified"]);
});

test("refresh failure and settings changes are audited without leaking credentials", async () => {
  const h = harness();
  await h.controller.initialize();
  await h.controller.updateSettings({ maxAddiction: 4 });
  assert.deepEqual(phases(h.storage, "settings"), ["changed"]);
  const settingsEntry = h.storage.audit.entries.find(entry => entry.type === "settings");
  assert.equal(settingsEntry.details.changedKeys.includes("maxAddiction"), true);

  h.api.fail = true;
  await h.controller.refresh();
  assert.deepEqual(phases(h.storage, "refresh"), ["failed"]);
});

test("controller exposes and clears persisted audit trail", async () => {
  const h = harness();
  await h.controller.initialize();
  await h.controller.trainEmployee(1);
  assert.equal((await h.controller.getAudit()).entries.length > 0, true);
  await h.controller.clearAudit();
  assert.deepEqual(await h.controller.getAudit(), { schemaVersion: 1, entries: [] });
});
