import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyOverrideState,
  setPriorityOnce,
  clearPriorityOnce,
  createSkip,
  clearSkip,
  isSkipped,
  expireOverrides
} from "../src/core/overrides.js";

test("priority once stores exactly one employee and can be cleared", () => {
  let state = setPriorityOnce(emptyOverrideState(), 42, 100);
  assert.equal(state.priorityOnceEmployeeId, 42);
  assert.equal(state.prioritySetAt, 100);
  state = clearPriorityOnce(state);
  assert.equal(state.priorityOnceEmployeeId, null);
});

test("timed skip expires automatically", () => {
  let state = createSkip(emptyOverrideState(), 42, { mode: "timed", until: 200, createdAt: 100 });
  assert.equal(isSkipped(state, 42, { nowSeconds: 150 }), true);
  state = expireOverrides(state, { nowSeconds: 201 });
  assert.equal(isSkipped(state, 42, { nowSeconds: 201 }), false);
});

test("manual skip lasts until explicitly cleared", () => {
  let state = createSkip(emptyOverrideState(), 42, { mode: "manual", createdAt: 100 });
  assert.equal(isSkipped(state, 42, { nowSeconds: 999999 }), true);
  state = clearSkip(state, 42);
  assert.equal(isSkipped(state, 42, { nowSeconds: 999999 }), false);
});

test("next rotation skip expires after another verified train", () => {
  let state = createSkip(emptyOverrideState(), 42, { mode: "next_rotation", createdAt: 100, verifiedTrainCountAtCreate: 10 });
  assert.equal(isSkipped(state, 42, { nowSeconds: 120, verifiedTrainCount: 10 }), true);
  state = expireOverrides(state, { nowSeconds: 130, verifiedTrainCount: 11 });
  assert.equal(isSkipped(state, 42, { nowSeconds: 130, verifiedTrainCount: 11 }), false);
});

test("until tomorrow skip expires at its explicit boundary", () => {
  let state = createSkip(emptyOverrideState(), 42, { mode: "until_tomorrow", until: 86400, createdAt: 100 });
  assert.equal(isSkipped(state, 42, { nowSeconds: 86399 }), true);
  assert.equal(isSkipped(state, 42, { nowSeconds: 86400 }), false);
});
