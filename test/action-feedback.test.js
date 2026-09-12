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

test("failed train actions remain visibly surfaced with the actual reason", () => {
  const html = companyManagerHtml(baseState({ type: "train", employeeId: 123, status: "failed", reason: "train_control_not_found" }));
  assert.match(html, /r4-tcm-error/i);
  assert.match(html, /train_control_not_found/i);
});

test("unverified train actions show an explicit verification lock warning", () => {
  const html = companyManagerHtml(baseState({ type: "train", employeeId: 123, status: "unverified" }));
  assert.match(html, /verification pending/i);
  assert.match(html, /do not retry/i);
  assert.match(html, /Company News confirms/i);
});
