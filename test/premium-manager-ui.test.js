import test from "node:test";
import assert from "node:assert/strict";
import { companyManagerHtml } from "../src/ui/company-manager.js";

function state() {
  const employees = [
    { id: 1, name: "Alice", joinedAt: 100, wage: 50000, addictionMagnitude: 0, lastActionRelative: "2 minutes ago" },
    { id: 2, name: "Bob", joinedAt: 100, wage: 50000, addictionMagnitude: 1, lastActionRelative: "5 minutes ago" },
    { id: 3, name: "Charlie", joinedAt: 100, wage: 50000, addictionMagnitude: 0, lastActionRelative: "10 minutes ago" },
    { id: 4, name: "Dave", joinedAt: 100, wage: 50000, addictionMagnitude: 0, lastActionRelative: "15 minutes ago" },
    { id: 5, name: "Eve", joinedAt: 100, wage: 50000, addictionMagnitude: 0, lastActionRelative: "20 minutes ago" }
  ];
  return {
    status: "ready", stale: false, trains: 6, lastUpdatedAt: 1000, error: null, action: null,
    settings: { maxAddiction: 3, rotationMode: "balanced" }, employees,
    eligibilityById: new Map(employees.map((e) => [e.id, { eligible: true, unverified: false, reasons: [], inactivitySeconds: 60, tenureSeconds: 500000 }])),
    trainingById: new Map(employees.map((e, i) => [e.id, { totalTrains: i + 1, lastTrainTimestamp: 900 - i * 100 }])),
    payroll: { recordsByEmployeeId: {} }, trainReceipts: { schemaVersion: 1, receiptsByEmployeeId: {} },
    paid: { schemaVersion: 1, contractsById: { p1: { id: "p1", employeeId: 1, status: "active", trainsPurchased: 20, trainsDelivered: 12, trainsRemaining: 8 } }, activeByEmployeeId: { "1": "p1" }, queue: ["p1"] },
    recommendation: {
      nextEmployeeId: 1,
      ordered: employees,
      sourceById: new Map([[1, "paid"], [2, "balanced_fairness"], [3, "balanced_fairness"], [4, "balanced_fairness"], [5, "balanced_fairness"]]),
      reasonById: new Map([[1, "paid_priority"], [2, "balanced_behind"]]),
      fairnessLabelById: new Map([[2, "Behind by 1.8"], [3, "On balance"]]),
      paidContractByEmployeeId: new Map([[1, { employeeId: 1, trainsRemaining: 8 }]])
    },
    rotation: { nextEmployeeId: 2, orderedEligible: employees, skipped: [], reasonById: new Map() },
    attention: [{ severity: "action", message: "Example" }]
  };
}

test("default premium surface shows essential training information and one obvious primary action", () => {
  const html = companyManagerHtml(state());
  assert.match(html, /<strong>6<\/strong><span>TRAINS<\/span>/i);
  assert.match(html, /Alice/);
  assert.match(html, /PAID/i);
  assert.match(html, /8\s*(?:remaining|left)/i);
  assert.match(html, /data-action="train-next"/);
  assert.match(html, /NEXT IN QUEUE/i);
  assert.match(html, /Eligible/i);
  assert.match(html, /data-action="settings"/);
  assert.match(html, /data-action="attention"/);
});

test("queue preview is capped at four employees", () => {
  const html = companyManagerHtml(state());
  const preview = html.match(/data-premium-queue[\s\S]*?<\/ol>/)?.[0] || "";
  assert.equal((preview.match(/<li/g) || []).length, 4);
});

test("default premium surface does not expose diagnostics JSON or seven-column wall", () => {
  const html = companyManagerHtml(state(), { diagnostics: { secretLookingNoise: "x" } });
  assert.doesNotMatch(html, /secretLookingNoise/);
  assert.doesNotMatch(html, /Diagnostics \/ Self-Test/i);
  assert.doesNotMatch(html, /<th>Addiction<\/th>/i);
  assert.doesNotMatch(html, /<th>Activity<\/th>/i);
  assert.doesNotMatch(html, /<th>Pay<\/th>/i);
});

test("roster keeps secondary power behind row details and contextual actions", () => {
  const html = companyManagerHtml(state());
  assert.match(html, /data-action="employee-menu"/);
  assert.match(html, /data-action="toggle-details"/);
  assert.match(html, /data-employee-details/);
  assert.match(html, /Addiction/i);
  assert.match(html, /Company time/i);
});
