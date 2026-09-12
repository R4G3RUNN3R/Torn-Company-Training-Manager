import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mountNativeTrainingIndicators, reminderTextFor } from "../src/ui/native-indicators.js";

function setup() {
  const dom = new JSDOM(`<!doctype html><html><body><ul class="employee-list"><li data-user="1"><span class="name">Alice</span><button class="fire">Fire</button></li><li data-user="2"><span class="name">Bob</span></li></ul></body></html>`, { url: "https://www.torn.com/companies.php?step=your#employees" });
  const employees = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }];
  const state = {
    employees,
    settings: { showNativeTrainingBadges: true },
    eligibilityById: new Map([[1, { eligible: true }], [2, { eligible: false, inactive: true, addictionViolation: false, inactivitySeconds: 100000, reasons: [{ code: "inactive" }] }]]),
    recommendation: { nextEmployeeId: 1, sourceById: new Map([[1, "paid"]]) },
    paid: { contractsById: { p: { id: "p", employeeId: 1, status: "active" } }, activeByEmployeeId: { "1": "p" }, queue: ["p"] },
    overrides: { priorityOnceEmployeeId: null }
  };
  return { dom, state };
}

test("native indicators add at most one compact training badge per employee row", () => {
  const { dom, state } = setup();
  mountNativeTrainingIndicators({ documentRef: dom.window.document, state });
  const alice = dom.window.document.querySelector('li[data-user="1"]');
  const bob = dom.window.document.querySelector('li[data-user="2"]');
  assert.equal(alice.querySelectorAll(".r4-tcm-native-badge").length, 1);
  assert.equal(bob.querySelectorAll(".r4-tcm-native-badge").length, 1);
  assert.match(alice.querySelector(".r4-tcm-native-badge").textContent, /NEXT/i);
  assert.match(bob.querySelector(".r4-tcm-native-badge").textContent, /INELIGIBLE/i);
});

test("native indicator rerender is idempotent and never injects a custom Train button next to Fire", () => {
  const { dom, state } = setup();
  mountNativeTrainingIndicators({ documentRef: dom.window.document, state });
  mountNativeTrainingIndicators({ documentRef: dom.window.document, state });
  const alice = dom.window.document.querySelector('li[data-user="1"]');
  assert.equal(alice.querySelectorAll(".r4-tcm-native-badge").length, 1);
  assert.equal(alice.querySelectorAll('[data-action="train"], .r4-tcm-train-primary').length, 0);
  assert.equal(alice.querySelectorAll(".fire").length, 1);
});

test("badge priority is NEXT then PAID then PRIORITY then PAUSED then INELIGIBLE", () => {
  const { dom, state } = setup();
  state.recommendation.nextEmployeeId = null;
  mountNativeTrainingIndicators({ documentRef: dom.window.document, state });
  assert.match(dom.window.document.querySelector('li[data-user="1"] .r4-tcm-native-badge').textContent, /^PAID$/i);
  state.overrides.priorityOnceEmployeeId = 1;
  state.paid.contractsById.p.status = "manually-paused";
  mountNativeTrainingIndicators({ documentRef: dom.window.document, state });
  assert.match(dom.window.document.querySelector('li[data-user="1"] .r4-tcm-native-badge').textContent, /^PRIORITY$/i);
  state.overrides.priorityOnceEmployeeId = null;
  mountNativeTrainingIndicators({ documentRef: dom.window.document, state });
  assert.match(dom.window.document.querySelector('li[data-user="1"] .r4-tcm-native-badge').textContent, /^PAUSED$/i);
});

test("reminder helper creates concise inactivity or addiction text without sending anything", () => {
  assert.match(reminderTextFor({ name: "Alice" }, { inactive: true, addictionViolation: false }), /Alice.*inactive.*training/i);
  assert.match(reminderTextFor({ name: "Bob" }, { inactive: false, addictionViolation: true, reasons: [{ code: "addiction", actual: 5, limit: 3 }] }), /Bob.*addiction.*5.*3/i);
});
