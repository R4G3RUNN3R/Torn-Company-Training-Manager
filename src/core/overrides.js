function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function emptyOverrideState() {
  return { schemaVersion: 1, priorityOnceEmployeeId: null, prioritySetAt: null, skipsByEmployeeId: {} };
}

export function normalizeOverrideState(value) {
  const state = emptyOverrideState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return state;
  const priorityId = Number(value.priorityOnceEmployeeId);
  if (Number.isInteger(priorityId) && priorityId > 0) {
    state.priorityOnceEmployeeId = priorityId;
    state.prioritySetAt = Number.isFinite(Number(value.prioritySetAt)) ? Number(value.prioritySetAt) : null;
  }
  const rawSkips = value.skipsByEmployeeId && typeof value.skipsByEmployeeId === "object" ? value.skipsByEmployeeId : {};
  for (const [key, raw] of Object.entries(rawSkips)) {
    const id = Number(raw?.employeeId ?? key);
    if (!Number.isInteger(id) || id <= 0 || !raw || typeof raw !== "object") continue;
    state.skipsByEmployeeId[String(id)] = { ...clone(raw), employeeId: id };
  }
  return state;
}

export function setPriorityOnce(value, employeeIdValue, timestamp = Math.floor(Date.now() / 1000)) {
  const state = normalizeOverrideState(value);
  const employeeId = Number(employeeIdValue);
  if (!Number.isInteger(employeeId) || employeeId <= 0) throw new TypeError("Employee ID must be a positive integer");
  state.priorityOnceEmployeeId = employeeId;
  state.prioritySetAt = Number(timestamp) || null;
  return state;
}

export function clearPriorityOnce(value) {
  const state = normalizeOverrideState(value);
  state.priorityOnceEmployeeId = null;
  state.prioritySetAt = null;
  return state;
}

export function createSkip(value, employeeIdValue, options = {}) {
  const state = normalizeOverrideState(value);
  const employeeId = Number(employeeIdValue);
  if (!Number.isInteger(employeeId) || employeeId <= 0) throw new TypeError("Employee ID must be a positive integer");
  const mode = options.mode;
  if (!["next_rotation", "until_tomorrow", "timed", "manual"].includes(mode)) throw new TypeError("Unsupported skip mode");
  const until = options.until == null ? null : Number(options.until);
  if (["timed", "until_tomorrow"].includes(mode) && !Number.isFinite(until)) throw new TypeError("Timed skip requires an expiry timestamp");
  const baseline = options.verifiedTrainCountAtCreate == null ? null : Number(options.verifiedTrainCountAtCreate);
  state.skipsByEmployeeId[String(employeeId)] = {
    employeeId,
    mode,
    createdAt: Number(options.createdAt) || Math.floor(Date.now() / 1000),
    until,
    verifiedTrainCountAtCreate: Number.isFinite(baseline) ? baseline : null
  };
  return state;
}

export function clearSkip(value, employeeIdValue) {
  const state = normalizeOverrideState(value);
  delete state.skipsByEmployeeId[String(Number(employeeIdValue))];
  return state;
}

function skipExpired(skip, { nowSeconds = Math.floor(Date.now() / 1000), verifiedTrainCount = null } = {}) {
  if (!skip) return true;
  if (skip.mode === "manual") return false;
  if (skip.mode === "timed" || skip.mode === "until_tomorrow") return Number(nowSeconds) >= Number(skip.until);
  if (skip.mode === "next_rotation") {
    if (!Number.isFinite(Number(skip.verifiedTrainCountAtCreate)) || !Number.isFinite(Number(verifiedTrainCount))) return false;
    return Number(verifiedTrainCount) > Number(skip.verifiedTrainCountAtCreate);
  }
  return true;
}

export function isSkipped(value, employeeIdValue, context = {}) {
  const state = normalizeOverrideState(value);
  const skip = state.skipsByEmployeeId[String(Number(employeeIdValue))];
  return Boolean(skip) && !skipExpired(skip, context);
}

export function expireOverrides(value, context = {}) {
  const state = normalizeOverrideState(value);
  for (const [key, skip] of Object.entries(state.skipsByEmployeeId)) {
    if (skipExpired(skip, context)) delete state.skipsByEmployeeId[key];
  }
  return state;
}
