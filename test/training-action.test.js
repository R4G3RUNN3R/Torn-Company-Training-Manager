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
