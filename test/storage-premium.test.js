import test from "node:test";
import assert from "node:assert/strict";
import { StorageRepo, STORAGE_KEYS } from "../src/infra/storage.js";

function gmFake(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    async getValue(key, fallback) { return values.has(key) ? structuredClone(values.get(key)) : structuredClone(fallback); },
    async setValue(key, value) { values.set(key, structuredClone(value)); },
    async deleteValue(key) { values.delete(key); }
  };
}

test("premium training domains recover safely from malformed storage", async () => {
  const gm = gmFake({
    [STORAGE_KEYS.paidContracts]: "bad",
    [STORAGE_KEYS.fairness]: { schemaVersion: 999 },
    [STORAGE_KEYS.overrides]: []
  });
  const repo = new StorageRepo(gm);
  assert.deepEqual(await repo.loadPaidContracts(), { schemaVersion: 1, contractsById: {}, activeByEmployeeId: {}, queue: [] });
  const fairness = await repo.loadFairness();
  assert.equal(fairness.schemaVersion, 1);
  assert.deepEqual(fairness.opportunities, []);
  assert.deepEqual(await repo.loadOverrides(), { schemaVersion: 1, priorityOnceEmployeeId: null, prioritySetAt: null, skipsByEmployeeId: {} });
});

test("premium training domains persist separately", async () => {
  const gm = gmFake();
  const repo = new StorageRepo(gm);
  await repo.savePaidContracts({ schemaVersion: 1, contractsById: { x: { id: "x", employeeId: 7, status: "active", trainsPurchased: 2, trainsDelivered: 0, trainsRemaining: 2 } }, activeByEmployeeId: { "7": "x" }, queue: ["x"] });
  await repo.saveFairness({ schemaVersion: 1, trackingStartedAt: 100, opportunities: [{ timestamp: 110, eligibleEmployeeIds: [7], allEmployeeIds: [7], trainedEmployeeId: 7 }] });
  await repo.saveOverrides({ schemaVersion: 1, priorityOnceEmployeeId: 7, prioritySetAt: 120, skipsByEmployeeId: {} });
  assert.equal((await repo.loadPaidContracts()).activeByEmployeeId["7"], "x");
  assert.equal((await repo.loadFairness()).opportunities.length, 1);
  assert.equal((await repo.loadOverrides()).priorityOnceEmployeeId, 7);
});

test("reset non-key data removes premium domains while preserving API key", async () => {
  const gm = gmFake({ [STORAGE_KEYS.apiKey]: "keep-me" });
  const repo = new StorageRepo(gm);
  await repo.savePaidContracts({});
  await repo.saveFairness({});
  await repo.saveOverrides({});
  await repo.resetNonKeyData();
  assert.equal(await repo.getApiKey(), "keep-me");
  assert.equal(gm.values.has(STORAGE_KEYS.paidContracts), false);
  assert.equal(gm.values.has(STORAGE_KEYS.fairness), false);
  assert.equal(gm.values.has(STORAGE_KEYS.overrides), false);
});
