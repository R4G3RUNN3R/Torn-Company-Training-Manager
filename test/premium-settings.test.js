import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../src/core/constants.js";
import { validateSettingsValues } from "../src/ui/settings.js";

test("premium training settings have safe simple defaults", () => {
  assert.equal(DEFAULT_SETTINGS.newHireHoldHours, 72);
  assert.equal(DEFAULT_SETTINGS.rotationMode, "fair");
  assert.equal(DEFAULT_SETTINGS.fairnessWindowDays, 30);
  assert.equal(DEFAULT_SETTINGS.accrueDebtWhileIneligible, false);
  assert.equal(DEFAULT_SETTINGS.removalThresholdDays, null);
  assert.equal(DEFAULT_SETTINGS.notificationMode, "important");
  assert.equal(DEFAULT_SETTINGS.showNativeTrainingBadges, true);
});

test("settings validation accepts balanced fairness and director removal threshold", () => {
  const value = validateSettingsValues({
    maxAddiction: "4",
    refreshMinutes: "3",
    prioritizeNeverTrained: true,
    showGlobalBadge: true,
    showTrainCount: true,
    rotationMode: "balanced",
    fairnessWindowDays: "60",
    accrueDebtWhileIneligible: true,
    removalThresholdDays: "5",
    notificationMode: "everything",
    showNativeTrainingBadges: false,
    compactDensity: true,
    reduceMotion: true
  });

  assert.equal(value.newHireHoldHours, 72);
  assert.equal(value.rotationMode, "balanced");
  assert.equal(value.fairnessWindowDays, 60);
  assert.equal(value.accrueDebtWhileIneligible, true);
  assert.equal(value.removalThresholdDays, 5);
  assert.equal(value.notificationMode, "everything");
  assert.equal(value.showNativeTrainingBadges, false);
  assert.equal(value.compactDensity, true);
  assert.equal(value.reduceMotion, true);
});

test("settings validation rejects unsupported training modes", () => {
  assert.throws(() => validateSettingsValues({
    maxAddiction: 3,
    refreshMinutes: 5,
    rotationMode: "chaos",
    fairnessWindowDays: 30,
    notificationMode: "important"
  }), /rotation mode/i);
});
