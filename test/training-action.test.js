import test from "node:test";
import assert from "node:assert/strict";
import { CompanyPageActions } from "../src/infra/company-page-actions.js";

function makeHarness({ token = "abc123def456", duplicate = false, noNativeTrain = false, noRow = false, pageHref = "https://www.torn.com/companies.php?step=your&type=3", response = { success: true }, httpOk = true } = {}) {
  const button = {
    disabled: false,
    className: "torn-btn",
    getAttribute(name) { return name === "aria-disabled" ? "false" : null; },
    closest(selector) {
      return selector === ".train-action"
        ? { disabled: false, className: "train-action btn-wrap", getAttribute() { return "false"; } }
        : null;
    }
  };
  const duplicateButton = { ...button, closest: button.closest };
  const row = {
    querySelectorAll(selector) {
      if (noNativeTrain) return [];
      if (selector === ".train .train-action.btn-wrap button.torn-btn") return duplicate ? [button, duplicateButton] : [button];
      return [];
    }
  };
  const rfcInput = token ? { value: token } : null;
  const document = {
    location: { origin: "https://www.torn.com", href: pageHref },
    cookie: "",
    querySelector(selector) {
      if (!noRow && selector.includes('li[data-user="4465537"]')) return row;
      if (selector === 'input[name="rfcv"]') return rfcInput;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href*="step=trainemp2"]') return [];
      if (selector === "form") return [];
      return [];
    }
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: httpOk,
      status: httpOk ? 200 : 500,
      async text() { return JSON.stringify(response); }
    };
  };
  return { document, fetchImpl, calls };
}

test("submitTrain posts Torn trainemp2 for the exact employee with current RFC token", async () => {
  const h = makeHarness();
  const actions = new CompanyPageActions(h);

  const result = await actions.submitTrain(4465537);

  assert.equal(result.status, "accepted");
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.method, "POST");
  assert.equal(h.calls[0].options.credentials, "same-origin");
  assert.equal(h.calls[0].options.headers["X-Requested-With"], "XMLHttpRequest");
  const url = new URL(h.calls[0].url);
  assert.equal(url.origin, "https://www.torn.com");
  assert.equal(url.pathname, "/companies.php");
  assert.equal(url.searchParams.get("rfcv"), "abc123def456");
  assert.equal(h.calls[0].options.body.get("step"), "trainemp2");
  assert.equal(h.calls[0].options.body.get("ID"), "4465537");
});

test("submitTrain fails closed when RFC token is unavailable", async () => {
  const h = makeHarness({ token: null });
  const actions = new CompanyPageActions(h);
  const result = await actions.submitTrain(4465537);
  assert.deepEqual(result, { status: "unsafe_dom", reason: "rfc_token_not_found" });
  assert.equal(h.calls.length, 0);
});

test("submitTrain does not require Torn native Train control when the exact employee row still exists", async () => {
  const h = makeHarness({ noNativeTrain: true });
  const actions = new CompanyPageActions(h);
  const result = await actions.submitTrain(4465537);
  assert.equal(result.status, "accepted");
  assert.equal(h.calls.length, 1);
});

test("submitTrain ignores duplicate native Train controls because direct POST target comes from exact employee id", async () => {
  const h = makeHarness({ duplicate: true });
  const actions = new CompanyPageActions(h);
  const result = await actions.submitTrain(4465537);
  assert.equal(result.status, "accepted");
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.body.get("ID"), "4465537");
});

test("submitTrain still fails closed when the exact employee row is unavailable", async () => {
  const h = makeHarness({ noRow: true });
  const actions = new CompanyPageActions(h);
  const result = await actions.submitTrain(4465537);
  assert.equal(result.status, "unsafe_dom");
  assert.equal(result.reason, "employee_row_not_found");
  assert.equal(h.calls.length, 0);
});

test("submitTrain fails closed outside the Torn company management page", async () => {
  const h = makeHarness({ pageHref: "https://www.torn.com/index.php" });
  const actions = new CompanyPageActions(h);
  const result = await actions.submitTrain(4465537);
  assert.equal(result.status, "unsafe_dom");
  assert.equal(result.reason, "not_company_management_page");
  assert.equal(h.calls.length, 0);
});

test("submitTrain reports Torn rejection without exposing raw authenticated payload", async () => {
  const h = makeHarness({ response: { success: false, error: "No trains available" } });
  const actions = new CompanyPageActions(h);
  const result = await actions.submitTrain(4465537);
  assert.equal(result.status, "rejected");
  assert.match(result.reason, /No trains available/i);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "text"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "response"), false);
});

test("inspectTrainingEnvironment exposes RFC and native-control presence but never the RFC value", () => {
  const h = makeHarness({ noNativeTrain: true });
  const actions = new CompanyPageActions(h);
  const inspection = actions.inspectTrainingEnvironment(4465537);
  const serialized = JSON.stringify(inspection);
  assert.equal(inspection.employeeRowFound, true);
  assert.equal(inspection.exactTrainControlFound, false);
  assert.equal(inspection.rfcTokenPresent, true);
  assert.equal(serialized.includes("abc123def456"), false);
});
