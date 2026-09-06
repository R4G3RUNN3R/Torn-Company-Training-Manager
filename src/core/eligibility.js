import { SECONDS_PER_DAY } from "./constants.js";

function validPolicy(settings) {
  return settings && Number.isFinite(Number(settings.maxAddiction)) && Number(settings.maxAddiction) >= 0;
}

export function evaluateEligibility(employee, settings, nowSeconds = Math.floor(Date.now() / 1000)) {
  const reasons = [];
  let unverified = false;
  let inactive = false;
  let addictionViolation = false;
  let inactivitySeconds = null;

  if (!validPolicy(settings)) {
    return {
      eligible: false,
      unverified: true,
      inactive: false,
      addictionViolation: false,
      reasons: [{ code: "unverified_policy" }],
      inactivitySeconds: null
    };
  }

  const lastAction = employee?.lastActionTimestamp;
  if (!Number.isFinite(lastAction)) {
    unverified = true;
    reasons.push({ code: "unverified_activity" });
  } else {
    inactivitySeconds = Math.max(0, Number(nowSeconds) - Number(lastAction));
    if (inactivitySeconds > SECONDS_PER_DAY) {
      inactive = true;
      reasons.push({ code: "inactive", actual: inactivitySeconds, limit: SECONDS_PER_DAY });
    }
  }

  const addiction = employee?.addictionMagnitude;
  if (!Number.isFinite(addiction)) {
    unverified = true;
    reasons.push({ code: "unverified_addiction" });
  } else if (Number(addiction) > Number(settings.maxAddiction)) {
    addictionViolation = true;
    reasons.push({ code: "addiction", actual: Number(addiction), limit: Number(settings.maxAddiction) });
  }

  return {
    eligible: !unverified && !inactive && !addictionViolation,
    unverified,
    inactive,
    addictionViolation,
    reasons,
    inactivitySeconds
  };
}
