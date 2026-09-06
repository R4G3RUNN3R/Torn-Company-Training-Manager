import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEligibility } from "../src/core/eligibility.js";
import { settingsFormHtml } from "../src/ui/settings.js";

const now = 2_000_000;

test("activity eligibility uses a fixed 24 hour cutoff regardless of stored inactivityDays", () => {
  const settings = { inactivityDays: 99, maxAddiction: 3 };
  const exactly24h = evaluateEligibility({ lastActionTimestamp: now - 86400, addictionMagnitude: 0 }, settings, now);
  const over24h = evaluateEligibility({ lastActionTimestamp: now - 86401, addictionMagnitude: 0 }, settings, now);

  assert.equal(exactly24h.eligible, true);
  assert.equal(exactly24h.inactive, false);
  assert.equal(over24h.eligible, false);
  assert.equal(over24h.inactive, true);
  assert.equal(over24h.reasons.find(reason => reason.code === "inactive")?.limit, 86400);
});

test("settings present the inactivity rule as fixed 24 hours rather than an editable threshold", () => {
  const html = settingsFormHtml({ settings: { inactivityDays: 3, maxAddiction: 3, refreshMinutes: 5 } });

  assert.doesNotMatch(html, /name="inactivityDays"/);
  assert.match(html, /24 hours/i);
  assert.match(html, /last action/i);
});
