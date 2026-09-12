import test from "node:test";
import assert from "node:assert/strict";
import { exportNonSecretState, previewImport, applyImport } from "../src/core/backup.js";

function storageFake() {
  return {
    settings: { schemaVersion: 1, maxAddiction: 3 },
    history: { schemaVersion: 1, eventsByNewsId: {}, unresolvedByNewsId: {}, newestTimestamp: 0 },
    payroll: { schemaVersion: 1, recordsByEmployeeId: {} },
    managerUi: { schemaVersion: 1, x: 10, y: 10, width: 600, height: 500, minimized: false, maximized: false },
    paid: { schemaVersion: 1, contractsById: {}, activeByEmployeeId: {}, queue: [] },
    fairness: { schemaVersion: 1, trackingStartedAt: 100, opportunities: [] },
    overrides: { schemaVersion: 1, priorityOnceEmployeeId: null, prioritySetAt: null, skipsByEmployeeId: {} },
    audit: { schemaVersion: 1, entries: [] },
    apiKey: "super-secret",
    backup: null,
    async loadSettings() { return structuredClone(this.settings); }, async saveSettings(v) { this.settings = structuredClone(v); },
    async loadHistory() { return structuredClone(this.history); }, async saveHistory(v) { this.history = structuredClone(v); },
    async loadPayroll() { return structuredClone(this.payroll); }, async savePayroll(v) { this.payroll = structuredClone(v); },
    async loadManagerUi() { return structuredClone(this.managerUi); }, async saveManagerUi(v) { this.managerUi = structuredClone(v); },
    async loadPaidContracts() { return structuredClone(this.paid); }, async savePaidContracts(v) { this.paid = structuredClone(v); },
    async loadFairness() { return structuredClone(this.fairness); }, async saveFairness(v) { this.fairness = structuredClone(v); },
    async loadOverrides() { return structuredClone(this.overrides); }, async saveOverrides(v) { this.overrides = structuredClone(v); },
    async loadAudit() { return structuredClone(this.audit); }, async saveAudit(v) { this.audit = structuredClone(v); },
    async saveBackup(v) { this.backup = structuredClone(v); },
    async getApiKey() { return this.apiKey; }
  };
}

test("export excludes API key and known secret fields", async () => {
  const storage = storageFake();
  storage.settings.authorization = "secret-header";
  const payload = await exportNonSecretState(storage, { includeAudit: true });
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("super-secret"), false);
  assert.equal(serialized.includes("secret-header"), false);
  assert.equal(serialized.toLowerCase().includes("apikey"), false);
  assert.equal(payload.schemaVersion, 1);
  assert.ok(payload.domains.paidContracts);
});

test("import preview rejects wrong schema and reports domain names", () => {
  assert.throws(() => previewImport({ schemaVersion: 999, domains: {} }), /schema/i);
  const preview = previewImport({ schemaVersion: 1, exportedAt: 100, domains: { settings: { schemaVersion: 1 }, paidContracts: { schemaVersion: 1, contractsById: {}, activeByEmployeeId: {}, queue: [] } } });
  assert.deepEqual(preview.domains.sort(), ["paidContracts", "settings"]);
});

test("apply import backs up current non-secret state before replacing validated domains", async () => {
  const storage = storageFake();
  const payload = { schemaVersion: 1, exportedAt: 200, domains: { settings: { schemaVersion: 1, maxAddiction: 5 }, overrides: { schemaVersion: 1, priorityOnceEmployeeId: 9, prioritySetAt: 200, skipsByEmployeeId: {} } } };
  await applyImport(storage, payload);
  assert.ok(storage.backup);
  assert.equal(storage.backup.domains.settings.maxAddiction, 3);
  assert.equal(storage.settings.maxAddiction, 5);
  assert.equal(storage.overrides.priorityOnceEmployeeId, 9);
  assert.equal(storage.apiKey, "super-secret");
});
