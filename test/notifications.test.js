import test from "node:test";
import assert from "node:assert/strict";
import { deriveAttentionItems, filterAttentionItems } from "../src/core/notifications.js";

const items = [
  { id: "critical", severity: "critical", category: "verification", message: "Unknown train" },
  { id: "action", severity: "action", category: "paid", message: "Paid paused" },
  { id: "info", severity: "info", category: "skip", message: "Skip expired" }
];

test("Important only keeps critical and director-action items", () => {
  assert.deepEqual(filterAttentionItems(items, { notificationMode: "important" }).map((x) => x.id), ["critical", "action"]);
});

test("Everything returns all optional attention while Silent returns none", () => {
  assert.equal(filterAttentionItems(items, { notificationMode: "everything" }).length, 3);
  assert.deepEqual(filterAttentionItems(items, { notificationMode: "silent" }), []);
});

test("Custom filters by configured severity categories", () => {
  const result = filterAttentionItems(items, { notificationMode: "custom", notifyCritical: true, notifyAction: false, notifyInfo: true });
  assert.deepEqual(result.map((x) => x.id), ["critical", "info"]);
});

test("attention derivation covers stale state unresolved train and paid pause without exposing secrets", () => {
  const state = {
    stale: true,
    trainReceipts: { receiptsByEmployeeId: { "7": { employeeId: 7, status: "accepted_unverified" } } },
    paid: { contractsById: { p: { id: "p", employeeId: 8, employeeName: "Bob", status: "auto-paused", trainsRemaining: 4 } }, activeByEmployeeId: { "8": "p" }, queue: ["p"] },
    employees: [{ id: 8, name: "Bob" }]
  };
  const result = deriveAttentionItems(state);
  assert.ok(result.some((x) => x.severity === "critical" && /stale/i.test(x.message)));
  assert.ok(result.some((x) => /verification/i.test(x.message)));
  assert.ok(result.some((x) => x.severity === "action" && /paid/i.test(x.message)));
  assert.equal(JSON.stringify(result).toLowerCase().includes("api_key"), false);
});
