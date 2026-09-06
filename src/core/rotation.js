function getFrom(mapLike, id) {
  if (mapLike instanceof Map) return mapLike.get(id);
  return mapLike?.[id] ?? mapLike?.[String(id)];
}

function joinedAtValue(employee) {
  return Number.isFinite(Number(employee?.joinedAt)) ? Number(employee.joinedAt) : Number.MAX_SAFE_INTEGER;
}

function idValue(employee) {
  const n = Number(employee?.id);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function historyInfo(trainingById, id) {
  const summary = getFrom(trainingById, id) || {};
  const totalTrains = Number.isFinite(Number(summary.totalTrains)) ? Number(summary.totalTrains) : 0;
  const last = Number.isFinite(Number(summary.lastTrainTimestamp)) ? Number(summary.lastTrainTimestamp) : null;
  return { totalTrains, lastTrainTimestamp: last };
}

export function rankTrainingCandidates({ employees = [], eligibilityById, trainingById, settings = {} } = {}) {
  const prioritizeNeverTrained = settings.prioritizeNeverTrained !== false;
  const eligibleRows = [];
  const skipped = [];
  const reasonById = new Map();

  for (const employee of [...employees]) {
    const eligibility = getFrom(eligibilityById, employee.id);
    const history = historyInfo(trainingById, employee.id);
    const row = { ...employee, trainingSummary: { ...history } };
    if (!eligibility?.eligible) {
      skipped.push(row);
      reasonById.set(employee.id, "skipped_ineligible");
      continue;
    }
    eligibleRows.push(row);
  }

  eligibleRows.sort((a, b) => {
    const ah = a.trainingSummary;
    const bh = b.trainingSummary;
    const aNever = ah.totalTrains === 0;
    const bNever = bh.totalTrains === 0;

    if (prioritizeNeverTrained && aNever !== bNever) return aNever ? -1 : 1;

    if (prioritizeNeverTrained && aNever && bNever) {
      return joinedAtValue(a) - joinedAtValue(b) || idValue(a) - idValue(b);
    }

    const aLast = ah.lastTrainTimestamp ?? 0;
    const bLast = bh.lastTrainTimestamp ?? 0;
    return aLast - bLast || joinedAtValue(a) - joinedAtValue(b) || idValue(a) - idValue(b);
  });

  eligibleRows.forEach((employee, index) => {
    const history = employee.trainingSummary;
    if (history.totalTrains === 0) reasonById.set(employee.id, "never_trained");
    else if (index === 0) reasonById.set(employee.id, "oldest_last_train");
    else reasonById.set(employee.id, "queued");
  });

  skipped.sort((a, b) => idValue(a) - idValue(b));
  return {
    orderedEligible: eligibleRows,
    skipped,
    nextEmployeeId: eligibleRows[0]?.id ?? null,
    reasonById
  };
}
