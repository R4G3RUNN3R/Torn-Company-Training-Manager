import test from "node:test";
import assert from "node:assert/strict";
import { TrainingManagerController } from "../src/app/controller-v110.js";

const payrollHealth = {
  employeeId: 4298323,
  employeeRowFound: true,
  wageInputCount: 1,
  submitControlCount: 1,
  targetDirty: false,
  dirtyEmployeeIds: [],
  apiWageCoverageOk: true
};

test("controller diagnostics include payroll health for the current action employee using API wage snapshots", () => {
  let inspectedEmployeeId = null;
  let inspectedWages = null;
  const pageActions = {
    inspectTrainingEnvironment() {
      return { employeeRowFound: true, rfcTokenPresent: true };
    },
    inspectPayrollEnvironment(wages, employeeId) {
      inspectedWages = wages;
      inspectedEmployeeId = employeeId;
      return payrollHealth;
    }
  };
  const controller = new TrainingManagerController({
    api: {},
    storage: {},
    pageActions,
    nowSeconds: () => 123456
  });
  const farQue = { id: 4298323, name: "FarQue2", wage: 10000 };
  controller.state = {
    ...controller.state,
    employees: [farQue, { id: 4465537, name: "MichaelLuam", wage: 25000 }],
    rotation: {
      orderedEligible: [{ id: 4465537, name: "MichaelLuam", wage: 25000 }],
      skipped: [],
      nextEmployeeId: 4465537,
      reasonById: new Map()
    },
    action: { type: "dock", employeeId: 4298323, status: "failed", reason: "submit_changes_not_unique" }
  };

  const diagnostics = controller.getDiagnostics();

  assert.deepEqual(diagnostics.page.payroll, payrollHealth);
  assert.equal(inspectedEmployeeId, 4298323);
  assert.equal(inspectedWages.get(4298323), 10000);
  assert.equal(inspectedWages.get(4465537), 25000);
});
