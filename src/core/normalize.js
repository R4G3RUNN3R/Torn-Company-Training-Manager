function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseUnixSeconds(value) {
  const n = finiteNumber(value);
  if (n === null || n < 0) return null;
  return Math.trunc(n);
}

export function normalizeAddiction(rawValue) {
  const n = finiteNumber(rawValue);
  return n === null ? null : Math.abs(n);
}

export function normalizeEmployee(raw = {}, nowSeconds = Math.floor(Date.now() / 1000)) {
  const id = finiteNumber(raw.id ?? raw.ID ?? raw.user_id);
  const wage = finiteNumber(raw.wage);
  const joinedAt = parseUnixSeconds(raw.joined_at);
  const lastActionTimestamp = parseUnixSeconds(raw.last_action?.timestamp);
  const rawAddictionEffectiveness = finiteNumber(raw.effectiveness?.addiction);
  const rawInactivityEffectiveness = finiteNumber(raw.effectiveness?.inactivity);
  const effectivenessTotal = finiteNumber(raw.effectiveness?.total);
  const daysInCompany = finiteNumber(raw.days_in_company);
  const position = raw.position ?? null;
  const positionName = typeof position === "string" ? position : (position?.name ?? null);
  const positionId = typeof position === "object" && position ? finiteNumber(position.id) : null;
  const normalizedNow = parseUnixSeconds(nowSeconds);
  const inactivitySeconds = lastActionTimestamp === null || normalizedNow === null
    ? null
    : Math.max(0, normalizedNow - lastActionTimestamp);

  return {
    id: id === null ? null : Math.trunc(id),
    name: typeof raw.name === "string" ? raw.name : "",
    positionId: positionId === null ? null : Math.trunc(positionId),
    positionName,
    daysInCompany: daysInCompany === null ? null : daysInCompany,
    joinedAt,
    wage: wage === null ? null : Math.trunc(wage),
    lastActionTimestamp,
    lastActionRelative: typeof raw.last_action?.relative === "string" ? raw.last_action.relative : null,
    lastActionStatus: typeof raw.last_action?.status === "string" ? raw.last_action.status : null,
    rawAddictionEffectiveness,
    addictionMagnitude: normalizeAddiction(rawAddictionEffectiveness),
    rawInactivityEffectiveness,
    effectivenessTotal,
    stats: raw.stats && typeof raw.stats === "object" ? { ...raw.stats } : null,
    inactivitySeconds
  };
}
