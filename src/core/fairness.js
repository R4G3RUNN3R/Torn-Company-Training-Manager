import { SECONDS_PER_DAY } from "./constants.js";

function uniqueNumericIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

export function emptyFairnessState(trackingStartedAt = Math.floor(Date.now() / 1000)) {
  return { schemaVersion: 1, trackingStartedAt: Number(trackingStartedAt) || 0, opportunities: [] };
}

export function normalizeFairnessState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyFairnessState();
  const trackingStartedAt = Number.isFinite(Number(value.trackingStartedAt)) ? Number(value.trackingStartedAt) : 0;
  const opportunities = [];
  for (const raw of Array.isArray(value.opportunities) ? value.opportunities : []) {
    const timestamp = Number(raw?.timestamp);
    const trainedEmployeeId = Number(raw?.trainedEmployeeId);
    if (!Number.isFinite(timestamp) || !Number.isInteger(trainedEmployeeId) || trainedEmployeeId <= 0) continue;
    opportunities.push({
      timestamp,
      trainedEmployeeId,
      eligibleEmployeeIds: uniqueNumericIds(raw.eligibleEmployeeIds),
      allEmployeeIds: uniqueNumericIds(raw.allEmployeeIds)
    });
  }
  opportunities.sort((a, b) => a.timestamp - b.timestamp);
  return { schemaVersion: 1, trackingStartedAt, opportunities };
}

export function recordFairnessTrain(value, event = {}) {
  const state = normalizeFairnessState(value);
  const timestamp = Number(event.timestamp);
  const trainedEmployeeId = Number(event.trainedEmployeeId);
  if (!Number.isFinite(timestamp)) throw new TypeError("Fairness event timestamp is required");
  if (!Number.isInteger(trainedEmployeeId) || trainedEmployeeId <= 0) throw new TypeError("Trained employee ID is required");
  state.opportunities.push({
    timestamp,
    trainedEmployeeId,
    eligibleEmployeeIds: uniqueNumericIds(event.eligibleEmployeeIds),
    allEmployeeIds: uniqueNumericIds(event.allEmployeeIds)
  });
  state.opportunities.sort((a, b) => a.timestamp - b.timestamp);
  if (!state.trackingStartedAt || timestamp < state.trackingStartedAt) state.trackingStartedAt = timestamp;
  return state;
}

export function fairnessScores(value, {
  nowSeconds = Math.floor(Date.now() / 1000),
  windowDays = 30,
  accrueDebtWhileIneligible = false
} = {}) {
  const state = normalizeFairnessState(value);
  const days = Number(windowDays);
  if (!Number.isFinite(days) || days <= 0) throw new TypeError("Fairness window must be greater than zero");
  const cutoff = Number(nowSeconds) - (days * SECONDS_PER_DAY);
  const expected = new Map();
  const actual = new Map();

  for (const event of state.opportunities) {
    if (event.timestamp < cutoff || event.timestamp > Number(nowSeconds)) continue;
    const participants = accrueDebtWhileIneligible && event.allEmployeeIds.length
      ? event.allEmployeeIds
      : event.eligibleEmployeeIds;
    const uniqueParticipants = uniqueNumericIds(participants);
    if (uniqueParticipants.length) {
      const share = 1 / uniqueParticipants.length;
      for (const id of uniqueParticipants) expected.set(id, (expected.get(id) || 0) + share);
    }
    actual.set(event.trainedEmployeeId, (actual.get(event.trainedEmployeeId) || 0) + 1);
  }

  const ids = new Set([...expected.keys(), ...actual.keys()]);
  const scores = new Map();
  for (const id of ids) {
    const score = (expected.get(id) || 0) - (actual.get(id) || 0);
    scores.set(id, Math.abs(score) < 1e-12 ? 0 : score);
  }
  return scores;
}
