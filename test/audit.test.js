import test from "node:test";
import assert from "node:assert/strict";
import { createAuditEntry, appendAuditEntry, sanitizeAuditValue, filterAuditEntries } from "../src/core/audit.js";
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

test("audit append retains only the latest 500 entries", () => {
  let state = { schemaVersion: 1, entries: [] };
  for (let i = 0; i < 501; i += 1) {
    state = appendAuditEntry(state, createAuditEntry({ type: "train", phase: "requested", employeeId: i }, 1_000 + i));
  }
  assert.equal(state.entries.length, 500);
  assert.equal(state.entries[0].employeeId, 1);
  assert.equal(state.entries.at(-1).employeeId, 500);
});

test("audit sanitization recursively redacts credentials and session secrets", () => {
  const value = sanitizeAuditValue({
    apiKey: "secret-api-key",
    nested: {
      rfcv: "rfc-secret",
      authorization: "ApiKey xyz",
      cookie: "session=abc",
      sessionId: "123",
      safeReason: "train rejected"
    }
  });
  const text = JSON.stringify(value);
  assert.equal(text.includes("secret-api-key"), false);
  assert.equal(text.includes("rfc-secret"), false);
  assert.equal(text.includes("ApiKey xyz"), false);
  assert.equal(text.includes("session=abc"), false);
  assert.equal(text.includes('"123"'), false);
  assert.equal(value.nested.safeReason, "train rejected");
});

test("audit filter matches type phase employee name and employee id", () => {
  const entries = [
    createAuditEntry({ type: "train", phase: "verified", employeeId: 10, employeeName: "Alice" }, 100),
    createAuditEntry({ type: "dock", phase: "verified", employeeId: 20, employeeName: "Bob" }, 200),
    createAuditEntry({ type: "train", phase: "rejected", employeeId: 30, employeeName: "Charlie" }, 300)
  ];
  assert.deepEqual(filterAuditEntries(entries, { type: "train", phase: "verified" }).map(e => e.employeeId), [10]);
  assert.deepEqual(filterAuditEntries(entries, { employee: "bob" }).map(e => e.employeeId), [20]);
  assert.deepEqual(filterAuditEntries(entries, { employee: "30" }).map(e => e.employeeId), [30]);
});

test("storage audit recovers safely, appends, and clears", async () => {
  const gm = gmFake({ [STORAGE_KEYS.audit]: { broken: true } });
  const storage = new StorageRepo(gm);
  const initial = await storage.loadAudit();
  assert.deepEqual(initial, { schemaVersion: 1, entries: [] });

  const entry = createAuditEntry({ type: "train", phase: "requested", employeeId: 42, employeeName: "Target" }, 500);
  await storage.appendAudit(entry);
  const loaded = await storage.loadAudit();
  assert.equal(loaded.entries.length, 1);
  assert.equal(loaded.entries[0].employeeId, 42);

  await storage.clearAudit();
  assert.deepEqual(await storage.loadAudit(), { schemaVersion: 1, entries: [] });
});
