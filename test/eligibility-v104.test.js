import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEligibility } from "../src/core/eligibility.js";
import { settingsFormHtml } from "../src/ui/settings.js";

const now = 2_000_000;

test("activity eligibility uses a fixed 24 hour cutoff regardless of stored inactivityDays", () => {
  const settings = { inactivityDays: 99, maxAddiction: 3 };
  const exactly24h = evaluateEligibility({ joinedAt: now - (72 * 3600), lastActionTimestamp: now - 86400, addictionMagnitude: 0 }, settings, now);
  const over24h = evaluateEligibility({ joinedAt: now - (72 * 3600), lastActionTimestamp: now - 86401, addictionMagnitude: 0 }, settings, now);

  assert.equal(exactly24h.eligible, true);
  assert.equal(exactly24h.inactive, false);
  assert.equal(over24h.eligible, false);
  assert.equal(over24h.inactive, true);
  assert.equal(over24h.reasons.find(reason => reason.code === "inactive")?.limit, 86400);
});

test("employee under 72 hours in company is ineligible for training", () => {
  const result = evaluateEligibility({
    joinedAt: now - (72 * 3600) + 1,
    lastActionTimestamp: now,
    addictionMagnitude: 0
  }, { maxAddiction: 3 }, now);

  assert.equal(result.eligible, false);
  assert.equal(result.newHireHold, true);
  assert.equal(result.tenureSeconds, (72 * 3600) - 1);
  assert.equal(result.reasons.find(reason => reason.code === "new_hire_hold")?.limit, 72 * 3600);
});

test("employee at exactly 72 hours may be eligible", () => {
  const result = evaluateEligibility({
    joinedAt: now - (72 * 3600),
    lastActionTimestamp: now,
    addictionMagnitude: 0
  }, { maxAddiction: 3 }, now);

  assert.equal(result.eligible, true);
  assert.equal(result.newHireHold, false);
  assert.equal(result.tenureSeconds, 72 * 3600);
});

test("missing company join time fails closed", () => {
  const result = evaluateEligibility({
    joinedAt: null,
    lastActionTimestamp: now,
    addictionMagnitude: 0
  }, { maxAddiction: 3 }, now);

  assert.equal(result.eligible, false);
  assert.equal(result.unverified, true);
  assert.ok(result.reasons.some(reason => reason.code === "unverified_tenure"));
});

test("settings present inactivity and new-hire rules as fixed policy", () => {
  const html = settingsFormHtml(
    { settings: { inactivityDays: 3, newHireHoldHours: 72, maxAddiction: 3, refreshMinutes: 5 } },
    { activeSection: "training" }
  );

  assert.doesNotMatch(html, /name="inactivityDays"/);
  assert.doesNotMatch(html, /name="newHireHoldHours"/);
  assert.match(html, /24 hours/i);
  assert.match(html, /72 hours|3 days/i);
  assert.match(html, /last action/i);
});
