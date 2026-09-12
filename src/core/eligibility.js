import { NEW_HIRE_HOLD_SECONDS, SECONDS_PER_DAY } from "./constants.js";

function validPolicy(settings) {
  return settings && Number.isFinite(Number(settings.maxAddiction)) && Number(settings.maxAddiction) >= 0;
}

function resolveTenureSeconds(employee, nowSeconds) {
  const joinedAt = Number(employee?.joinedAt);
  if (Number.isFinite(joinedAt)) return Math.max(0, Number(nowSeconds) - joinedAt);
  const daysInCompany = Number(employee?.daysInCompany);
  if (Number.isFinite(daysInCompany) && daysInCompany >= 0) return daysInCompany * SECONDS_PER_DAY;
  return null;
}

export function evaluateEligibility(employee, settings, nowSeconds = Math.floor(Date.now() / 1000)) {
  const reasons = [];
  let unverified = false;
  let inactive = false;
  let addictionViolation = false;
  let newHireHold = false;
  let inactivitySeconds = null;
  let tenureSeconds = null;

  if (!validPolicy(settings)) {
    return {
      eligible: false,
      unverified: true,
      inactive: false,
      addictionViolation: false,
      newHireHold: false,
      reasons: [{ code: "unverified_policy" }],
      inactivitySeconds: null,
      tenureSeconds: null
    };
  }

  tenureSeconds = resolveTenureSeconds(employee, nowSeconds);
  if (!Number.isFinite(tenureSeconds)) {
    unverified = true;
    reasons.push({ code: "unverified_tenure" });
  } else if (tenureSeconds < NEW_HIRE_HOLD_SECONDS) {
    newHireHold = true;
    reasons.push({ code: "new_hire_hold", actual: tenureSeconds, limit: NEW_HIRE_HOLD_SECONDS });
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
    eligible: !unverified && !inactive && !addictionViolation && !newHireHold,
    unverified,
    inactive,
    addictionViolation,
    newHireHold,
    reasons,
    inactivitySeconds,
    tenureSeconds
  };
}
