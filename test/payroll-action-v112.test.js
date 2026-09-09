import test from "node:test";
import assert from "node:assert/strict";
import { CompanyPageActions } from "../src/infra/company-page-actions.js";

function makeInput(value) {
  const events = [];
  return {
    value: String(value),
    disabled: false,
    events,
    dispatchEvent(event) {
      events.push(event?.type || String(event));
      return true;
    }
  };
}

function makeRow(id, wage) {
  const input = makeInput(wage);
  return {
    dataset: { user: String(id) },
    input,
    getAttribute(name) { return name === "data-user" ? String(id) : null; },
    querySelectorAll(selector) {
      if (selector === ".pay input") return [input];
      return [];
    }
  };
}

function makeHarness() {
  const targetRow = makeRow(4298323, 10000);
  const otherRow = makeRow(4465537, 25000);
  const rows = [targetRow, otherRow];
  const submit = {
    disabled: false,
    className: "torn-btn",
    textContent: "SUBMIT CHANGES",
    clicks: 0,
    getAttribute(name) { return name === "aria-disabled" ? "false" : null; },
    click() { this.clicks += 1; }
  };
  const fetchCalls = [];
  const document = {
    location: { origin: "https://www.torn.com", href: "https://www.torn.com/companies.php?step=your&type=3#/employees" },
    defaultView: { Event: class Event { constructor(type) { this.type = type; } } },
    querySelector(selector) {
      const match = selector.match(/data-user=\"(\d+)\"/);
      if (match) return rows.find((row) => row.dataset.user === match[1]) || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "form") return [];
      if (selector.includes("li[data-user]") || selector.includes("tr[data-user]")) return rows;
      if (selector.includes("button") || selector.includes("input[type='submit']") || selector.includes("input[type=\"submit\"]")) return [submit];
      return [];
    }
  };
  const fetchImpl = async (...args) => {
    fetchCalls.push(args);
    throw new Error("payroll row flow should not fetch directly");
  };
  return { document, fetchImpl, targetRow, otherRow, submit, fetchCalls };
}

test("submitWageChange targets the exact employee .pay input and clicks Torn Submit Changes without a page-level payroll form", async () => {
  const h = makeHarness();
  const actions = new CompanyPageActions({ document: h.document, fetchImpl: h.fetchImpl });

  const result = await actions.submitWageChange({
    employeeId: 4298323,
    targetWage: 0,
    apiWagesById: new Map([[4298323, 10000], [4465537, 25000]])
  });

  assert.equal(result.status, "submitted");
  assert.equal(h.targetRow.input.value, "0");
  assert.deepEqual(h.targetRow.input.events, ["input", "change", "blur"]);
  assert.equal(h.otherRow.input.value, "25000");
  assert.equal(h.submit.clicks, 1);
  assert.equal(h.fetchCalls.length, 0);
});

test("submitWageChange refuses to submit when another employee wage field is already dirty", async () => {
  const h = makeHarness();
  h.otherRow.input.value = "26000";
  const actions = new CompanyPageActions({ document: h.document, fetchImpl: h.fetchImpl });

  const result = await actions.submitWageChange({
    employeeId: 4298323,
    targetWage: 0,
    apiWagesById: new Map([[4298323, 10000], [4465537, 25000]])
  });

  assert.deepEqual(result, {
    status: "unsafe_dom",
    reason: "unrelated_dirty_wage",
    employeeId: 4465537
  });
  assert.equal(h.targetRow.input.value, "10000");
  assert.deepEqual(h.targetRow.input.events, []);
  assert.equal(h.submit.clicks, 0);
  assert.equal(h.fetchCalls.length, 0);
});
