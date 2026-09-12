const TERMINAL = new Set(["completed", "cancelled", "forfeited"]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function positiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new TypeError(`${label} must be a positive whole number`);
  return n;
}

function numericEmployeeId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new TypeError("Employee ID must be a positive integer");
  return id;
}

function activeContract(state, employeeIdValue) {
  const employeeId = numericEmployeeId(employeeIdValue);
  const id = state.activeByEmployeeId[String(employeeId)];
  if (!id) throw new Error("No active paid agreement for employee");
  const contract = state.contractsById[id];
  if (!contract || TERMINAL.has(contract.status)) throw new Error("No active paid agreement for employee");
  return { employeeId, id, contract };
}

function makeContractId(state, employeeId, createdAt) {
  const base = `paid-${Number(createdAt) || 0}-${employeeId}`;
  if (!state.contractsById[base]) return base;
  let suffix = 2;
  while (state.contractsById[`${base}-${suffix}`]) suffix += 1;
  return `${base}-${suffix}`;
}

export function emptyPaidState() {
  return { schemaVersion: 1, contractsById: {}, activeByEmployeeId: {}, queue: [] };
}

export function normalizePaidState(value) {
  const state = emptyPaidState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return state;
  const rawContracts = value.contractsById && typeof value.contractsById === "object" ? value.contractsById : {};
  for (const [id, raw] of Object.entries(rawContracts)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const employeeId = Number(raw.employeeId);
    if (!Number.isInteger(employeeId) || employeeId <= 0) continue;
    state.contractsById[id] = {
      ...clone(raw),
      id,
      employeeId,
      trainsPurchased: Math.max(0, Number(raw.trainsPurchased) || 0),
      trainsDelivered: Math.max(0, Number(raw.trainsDelivered) || 0),
      trainsRemaining: Math.max(0, Number(raw.trainsRemaining) || 0)
    };
  }
  const rawActive = value.activeByEmployeeId && typeof value.activeByEmployeeId === "object" ? value.activeByEmployeeId : {};
  for (const [employeeId, contractId] of Object.entries(rawActive)) {
    const contract = state.contractsById[contractId];
    if (!contract || TERMINAL.has(contract.status)) continue;
    state.activeByEmployeeId[String(Number(employeeId))] = contractId;
  }
  const seen = new Set();
  for (const id of Array.isArray(value.queue) ? value.queue : []) {
    if (!state.contractsById[id] || TERMINAL.has(state.contractsById[id].status) || seen.has(id)) continue;
    state.queue.push(id);
    seen.add(id);
  }
  for (const id of Object.values(state.activeByEmployeeId)) {
    if (!seen.has(id)) state.queue.push(id);
  }
  return state;
}

export function createPaidContract(value, input = {}) {
  const state = normalizePaidState(value);
  const employeeId = numericEmployeeId(input.employeeId);
  if (state.activeByEmployeeId[String(employeeId)]) throw new Error("Employee already has an active paid agreement");
  const trainsPurchased = positiveInt(input.trainsPurchased, "Trains purchased");
  const createdAt = Number(input.createdAt) || Math.floor(Date.now() / 1000);
  const id = makeContractId(state, employeeId, createdAt);
  state.contractsById[id] = {
    id,
    employeeId,
    employeeName: typeof input.employeeName === "string" ? input.employeeName : "",
    trainsPurchased,
    trainsDelivered: 0,
    trainsRemaining: trainsPurchased,
    createdAt,
    startedAt: Number(input.startedAt) || createdAt,
    pricePerTrain: Number.isFinite(Number(input.pricePerTrain)) ? Number(input.pricePerTrain) : null,
    totalPaid: Number.isFinite(Number(input.totalPaid)) ? Number(input.totalPaid) : null,
    note: typeof input.note === "string" ? input.note : "",
    status: "active",
    pauseReason: null,
    pausedAt: null,
    closedAt: null,
    closedReason: null
  };
  state.activeByEmployeeId[String(employeeId)] = id;
  state.queue.push(id);
  return state;
}

export function amendPaidContract(value, employeeIdValue, patch = {}, timestamp = Math.floor(Date.now() / 1000)) {
  const state = normalizePaidState(value);
  const { contract } = activeContract(state, employeeIdValue);
  const addTrains = patch.addTrains == null ? 0 : positiveInt(patch.addTrains, "Additional trains");
  contract.trainsPurchased += addTrains;
  contract.trainsRemaining += addTrains;
  if (Object.hasOwn(patch, "pricePerTrain")) contract.pricePerTrain = Number.isFinite(Number(patch.pricePerTrain)) ? Number(patch.pricePerTrain) : null;
  if (Object.hasOwn(patch, "totalPaid")) contract.totalPaid = Number.isFinite(Number(patch.totalPaid)) ? Number(patch.totalPaid) : null;
  if (Object.hasOwn(patch, "note")) contract.note = typeof patch.note === "string" ? patch.note : "";
  contract.updatedAt = Number(timestamp) || contract.updatedAt || contract.createdAt;
  return state;
}

function eligibilityFrom(mapLike, employeeId) {
  if (mapLike instanceof Map) return mapLike.get(employeeId);
  return mapLike?.[employeeId] ?? mapLike?.[String(employeeId)];
}

export function syncPaidEligibility(value, eligibilityById, timestamp = Math.floor(Date.now() / 1000)) {
  const state = normalizePaidState(value);
  for (const id of state.queue) {
    const contract = state.contractsById[id];
    if (!contract || TERMINAL.has(contract.status) || contract.status === "manually-paused") continue;
    const eligible = eligibilityFrom(eligibilityById, contract.employeeId)?.eligible === true;
    if (!eligible && contract.status === "active") {
      contract.status = "auto-paused";
      contract.pauseReason = "ineligible";
      contract.pausedAt = Number(timestamp) || null;
    } else if (eligible && contract.status === "auto-paused") {
      contract.status = "active";
      contract.pauseReason = null;
      contract.pausedAt = null;
    }
  }
  return state;
}

export function pausePaidContract(value, employeeIdValue, { timestamp = Math.floor(Date.now() / 1000), reason = "director" } = {}) {
  const state = normalizePaidState(value);
  const { contract } = activeContract(state, employeeIdValue);
  contract.status = "manually-paused";
  contract.pauseReason = reason == null ? "director" : String(reason);
  contract.pausedAt = Number(timestamp) || null;
  return state;
}

export function resumePaidContract(value, employeeIdValue, { timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const state = normalizePaidState(value);
  const { contract } = activeContract(state, employeeIdValue);
  if (contract.status !== "manually-paused") throw new Error("Paid agreement is not manually paused");
  contract.status = "active";
  contract.pauseReason = null;
  contract.pausedAt = null;
  contract.updatedAt = Number(timestamp) || null;
  return state;
}

export function recordVerifiedPaidTrain(value, employeeIdValue, { timestamp = Math.floor(Date.now() / 1000), countsTowardPaid = true } = {}) {
  const state = normalizePaidState(value);
  if (!countsTowardPaid) return state;
  const employeeId = numericEmployeeId(employeeIdValue);
  const id = state.activeByEmployeeId[String(employeeId)];
  if (!id) return state;
  const contract = state.contractsById[id];
  if (!contract || TERMINAL.has(contract.status)) return state;
  contract.trainsDelivered = Math.min(contract.trainsPurchased, contract.trainsDelivered + 1);
  contract.trainsRemaining = Math.max(0, contract.trainsRemaining - 1);
  contract.lastDeliveredAt = Number(timestamp) || null;
  if (contract.trainsRemaining === 0) {
    contract.status = "completed";
    contract.closedAt = Number(timestamp) || null;
    contract.closedReason = "fulfilled";
    delete state.activeByEmployeeId[String(employeeId)];
    state.queue = state.queue.filter((contractId) => contractId !== id);
  }
  return state;
}

export function reorderPaidQueue(value, orderedIds = []) {
  const state = normalizePaidState(value);
  const current = [...state.queue];
  if (!Array.isArray(orderedIds) || orderedIds.length !== current.length) throw new TypeError("Paid queue reorder must include every active agreement exactly once");
  const expected = [...current].sort();
  const actual = [...new Set(orderedIds)].sort();
  if (actual.length !== current.length || expected.some((id, index) => id !== actual[index])) throw new TypeError("Paid queue reorder contains invalid agreement IDs");
  state.queue = [...orderedIds];
  return state;
}

export function closePaidContract(value, employeeIdValue, { outcome, timestamp = Math.floor(Date.now() / 1000), reason = null } = {}) {
  if (!["cancelled", "forfeited"].includes(outcome)) throw new TypeError("Paid agreement close outcome must be cancelled or forfeited");
  const state = normalizePaidState(value);
  const { employeeId, id, contract } = activeContract(state, employeeIdValue);
  contract.status = outcome;
  contract.closedAt = Number(timestamp) || null;
  contract.closedReason = reason == null ? null : String(reason);
  delete state.activeByEmployeeId[String(employeeId)];
  state.queue = state.queue.filter((contractId) => contractId !== id);
  return state;
}
