import test from "node:test";
import assert from "node:assert/strict";
import { CompanyPageActions } from "../src/infra/company-page-actions.js";

test("submitTrain activates Torn's loaded native Train control instead of fetching its href", async () => {
  const events = [];
  let fetchCalls = 0;
  const link = {
    href: "https://www.torn.com/companies.php?step=trainemp2&ID=4465537",
    getAttribute(name) { return name === "href" ? this.href : null; },
    dispatchEvent(event) { events.push(event.type); return true; }
  };
  const document = {
    location: { origin: "https://www.torn.com" },
    defaultView: {
      MouseEvent: class MouseEvent {
        constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
      }
    },
    querySelectorAll(selector) {
      return selector === 'a[href*="step=trainemp2"]' ? [link] : [];
    }
  };
  const actions = new CompanyPageActions({
    document,
    fetchImpl: async () => { fetchCalls += 1; throw new Error("fetch should not be used for Torn Train"); }
  });

  const result = await actions.submitTrain(4465537);

  assert.equal(result.status, "submitted");
  assert.equal(result.method, "native_click");
  assert.equal(fetchCalls, 0);
  assert.deepEqual(events, ["mousedown", "mouseup", "click"]);
});

test("submitTrain resolves Torn's button-based Train control from the exact employee data-user row", async () => {
  const events = [];
  const button = {
    disabled: false,
    className: "torn-btn",
    getAttribute(name) { return name === "aria-disabled" ? "false" : null; },
    closest(selector) { return selector === ".train-action" ? { disabled: false, className: "train-action btn-wrap", getAttribute() { return "false"; } } : null; },
    dispatchEvent(event) { events.push(event.type); return true; }
  };
  const row = {
    querySelectorAll(selector) {
      if (selector === ".train .train-action.btn-wrap button.torn-btn") return [button];
      return [];
    }
  };
  const document = {
    location: { origin: "https://www.torn.com" },
    defaultView: {
      MouseEvent: class MouseEvent {
        constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
      }
    },
    querySelector(selector) {
      if (selector.includes('li[data-user="4465537"]')) return row;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href*="step=trainemp2"]') return [];
      return [];
    }
  };
  const actions = new CompanyPageActions({ document, fetchImpl: async () => { throw new Error("fetch should not be used"); } });

  const result = await actions.submitTrain(4465537);

  assert.equal(result.status, "submitted");
  assert.equal(result.method, "native_click");
  assert.deepEqual(events, ["mousedown", "mouseup", "click"]);
});
