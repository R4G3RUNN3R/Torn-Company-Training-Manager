import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { auditLogHtml, visibleAuditEntries, renderAuditLogModal } from "../src/ui/audit-log.js";
import { companyManagerHtml } from "../src/ui/company-manager.js";

const entries = [
  { id: "1", timestamp: 100, type: "train", phase: "verified", employeeId: 1, employeeName: "Alice", details: { trainsAfter: 2 } },
  { id: "2", timestamp: 300, type: "dock", phase: "verified", employeeId: 2, employeeName: "Bob", details: { dockedWage: 10000 } },
  { id: "3", timestamp: 200, type: "train", phase: "rejected", employeeId: 3, employeeName: "Charlie", details: { reason: "No trains" } }
];

function managerState() {
  const employee = { id: 1, name: "Alice", wage: 50000, addictionMagnitude: 0, rawAddictionEffectiveness: 0, lastActionRelative: "5 minutes ago" };
  return {
    status: "ready",
    stale: false,
    trains: 2,
    lastUpdatedAt: 100,
    employees: [employee],
    eligibilityById: new Map([[1, { eligible: true, unverified: false, inactive: false, addictionViolation: false, reasons: [] }]]),
    trainingById: new Map([[1, { totalTrains: 1, lastTrainTimestamp: 50 }]]),
    rotation: { nextEmployeeId: 1, orderedEligible: [employee], skipped: [], reasonById: new Map() },
    payroll: { recordsByEmployeeId: {} },
    settings: { maxAddiction: 3 },
    action: null,
    error: null
  };
}

test("visible audit entries are filtered and sorted newest first", () => {
  assert.deepEqual(visibleAuditEntries(entries, { type: "train" }).map(entry => entry.id), ["3", "1"]);
  assert.deepEqual(visibleAuditEntries(entries, { phase: "verified", employee: "bob" }).map(entry => entry.id), ["2"]);
});

test("audit log markup exposes filters, copy, export and clear actions", () => {
  const html = auditLogHtml(entries, { type: "all", phase: "all", employee: "" });
  assert.match(html, /Audit Log/);
  assert.match(html, /data-audit-filter="type"/);
  assert.match(html, /data-audit-filter="phase"/);
  assert.match(html, /data-audit-filter="employee"/);
  assert.match(html, /Copy Visible Log/);
  assert.match(html, /Export JSON/);
  assert.match(html, /Clear Log/);
  assert.ok(html.indexOf("Bob") < html.indexOf("Charlie"));
});

test("premium manager keeps Audit Log and Diagnostics off the default surface while preserving Gear and window controls", () => {
  const html = companyManagerHtml(managerState(), {
    diagnostics: { controller: { employeeCount: 1 }, page: { rfcTokenPresent: true } }
  });
  assert.doesNotMatch(html, /data-action="audit-log"/);
  assert.doesNotMatch(html, /Diagnostics \/ Self-Test/);
  assert.doesNotMatch(html, /Copy Diagnostics/);
  assert.match(html, /data-window-action="minimize"/);
  assert.match(html, /data-window-action="maximize"/);
  assert.match(html, /title="Settings">⚙<\/button>/);
});

test("audit modal clear action requires explicit confirmation before invoking clear callback", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://www.torn.com/companies.php?step=your" });
  let clears = 0;
  const modal = renderAuditLogModal({
    entries,
    documentRef: dom.window.document,
    confirmClear: async () => false,
    onClear: async () => { clears += 1; return []; }
  });
  modal.querySelector('[data-audit-action="clear"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(clears, 0);
  modal.remove();

  const modal2 = renderAuditLogModal({
    entries,
    documentRef: dom.window.document,
    confirmClear: async () => true,
    onClear: async () => { clears += 1; return []; }
  });
  modal2.querySelector('[data-audit-action="clear"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(clears, 1);
});
