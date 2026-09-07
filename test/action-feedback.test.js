import test from "node:test";
import assert from "node:assert/strict";
import { companyManagerHtml } from "../src/ui/company-manager.js";

function baseState(action) {
  return {
    status: "ready",
    stale: false,
    trains: 1,
    lastUpdatedAt: 1,
    error: null,
    action,
    settings: { maxAddiction: 3 },
    employees: [],
    eligibilityById: new Map(),
    trainingById: new Map(),
    rotation: { nextEmployeeId: null, orderedEligible: [], skipped: [] },
    payroll: { recordsByEmployeeId: {} }
  };
}

test("failed train actions are shown visibly instead of disappearing silently", () => {
  const html = companyManagerHtml(baseState({ type: "train", employeeId: 123, status: "failed", reason: "train_control_not_found" }));
  assert.match(html, /Train failed/i);
  assert.match(html, /train_control_not_found/i);
});

test("unverified train actions show an explicit verification warning", () => {
  const html = companyManagerHtml(baseState({ type: "train", employeeId: 123, status: "unverified" }));
  assert.match(html, /not confirm/i);
  assert.match(html, /refresh/i);
});
