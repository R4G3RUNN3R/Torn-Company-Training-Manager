# Premium Training Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved v1.2.0 training-only premium redesign with 72-hour new-hire eligibility, paid-train priority, Fair/Balanced rotation, Priority Once, Skip/Snooze, compact attention/notifications, progressive settings, local recovery, and a persistent Job/Company floating manager that minimizes completely into a sidebar icon.

**Architecture:** Preserve the existing controller's fail-closed write/verification path as the only training executor. Add small pure core modules for paid commitments, fairness, overrides, attention, and recommendation; persist those domains independently; let the controller compose them into one derived recommendation state. UI remains a thin renderer over controller state and uses contextual actions/Gear sections rather than exposing every option at once.

**Tech Stack:** JavaScript ES modules, Node >=20 built-in test runner, jsdom, Tampermonkey GM storage APIs, esbuild.

**Spec:** `docs/superpowers/specs/2026-09-12-premium-training-manager-design.md`

## Global Constraints

- Security first, performance second, ease of use third.
- Keep explicit confirmation, fresh preflight, exact employee targeting, accepted-versus-verified separation, persistent train receipts, and cross-tab duplicate protection.
- No automatic or unattended Torn write actions.
- No automatic firing or messaging.
- No remote telemetry, backend, Google Sheets, external fonts, or non-training ERP features.
- New-hire training hold is exactly 72 hours.
- Existing inactivity cutoff remains strictly greater than 24 hours; exactly 24 hours remains eligible.
- Fair Rotation remains the default.
- Balanced Fairness default rolling window is 30 days and does not accrue debt while ineligible unless explicitly enabled.
- Paid balance changes only after independent verification.
- The main UI remains intentionally simple; advanced options live behind Gear/contextual actions.
- Target package/release version: `1.2.0`.

---

### Task 1: Extend eligibility and settings defaults

**Files:**
- Modify: `src/core/constants.js`
- Modify: `src/core/eligibility.js`
- Modify: `src/ui/settings.js`
- Test: `test/eligibility-v104.test.js`
- Create: `test/premium-settings.test.js`

**Interfaces:**
- Consumes: normalized employee fields `joinedAt`, `daysInCompany`, `lastActionTimestamp`, `addictionMagnitude`.
- Produces: `evaluateEligibility(employee, settings, nowSeconds)` with `newHireHold`, `tenureSeconds`, and reason code `new_hire_hold`; expanded `DEFAULT_SETTINGS` keys.

- [ ] **Step 1: Write failing eligibility tests for the 72-hour hold**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEligibility } from "../src/core/eligibility.js";

const settings = { maxAddiction: 3 };
const now = 2_000_000;

test("employee under 72 hours in company is ineligible", () => {
  const result = evaluateEligibility({
    joinedAt: now - (72 * 3600) + 1,
    lastActionTimestamp: now,
    addictionMagnitude: 0
  }, settings, now);
  assert.equal(result.eligible, false);
  assert.equal(result.newHireHold, true);
  assert.equal(result.reasons[0].code, "new_hire_hold");
});

test("employee at exactly 72 hours may be eligible", () => {
  const result = evaluateEligibility({
    joinedAt: now - (72 * 3600),
    lastActionTimestamp: now,
    addictionMagnitude: 0
  }, settings, now);
  assert.equal(result.eligible, true);
  assert.equal(result.newHireHold, false);
});

test("missing join time fails closed", () => {
  const result = evaluateEligibility({
    joinedAt: null,
    lastActionTimestamp: now,
    addictionMagnitude: 0
  }, settings, now);
  assert.equal(result.eligible, false);
  assert.equal(result.unverified, true);
  assert.ok(result.reasons.some((reason) => reason.code === "unverified_tenure"));
});
```

- [ ] **Step 2: Run the eligibility tests and verify RED**

Run: `node --test test/eligibility-v104.test.js`

Expected: new 72-hour assertions fail because tenure is not yet part of eligibility.

- [ ] **Step 3: Add explicit settings defaults**

```js
export const DEFAULT_SETTINGS = Object.freeze({
  inactivityDays: 1,
  newHireHoldHours: 72,
  maxAddiction: 3,
  prioritizeNeverTrained: true,
  rotationMode: "fair",
  fairnessWindowDays: 30,
  accrueDebtWhileIneligible: false,
  removalThresholdDays: null,
  notificationMode: "important",
  showGlobalBadge: true,
  showTrainCount: true,
  showNativeTrainingBadges: true,
  compactDensity: false,
  reduceMotion: false,
  refreshMinutes: 5
});
```

- [ ] **Step 4: Implement the new-hire gate without weakening existing inactivity/addiction checks**

Use a fixed `72 * 3600` eligibility threshold even though the setting is displayed as policy information. `newHireHoldHours` is persisted for UI compatibility but validation must normalize it back to `72` so the hard rule cannot silently drift.

- [ ] **Step 5: Add failing/passing settings validation tests**

`test/premium-settings.test.js` must assert defaults and validation for `rotationMode`, `fairnessWindowDays`, `accrueDebtWhileIneligible`, nullable positive `removalThresholdDays`, notification mode, and hard-normalized `newHireHoldHours: 72`.

- [ ] **Step 6: Run targeted tests then full suite**

Run: `node --test test/eligibility-v104.test.js test/premium-settings.test.js`

Then: `npm test`

- [ ] **Step 7: Commit**

```bash
git add src/core/constants.js src/core/eligibility.js src/ui/settings.js test/eligibility-v104.test.js test/premium-settings.test.js
git commit -m "feat: enforce premium training eligibility policy"
```

---

### Task 2: Add pure paid-contract, override, and fairness domains

**Files:**
- Create: `src/core/paid-contracts.js`
- Create: `src/core/overrides.js`
- Create: `src/core/fairness.js`
- Create: `test/paid-contracts.test.js`
- Create: `test/overrides.test.js`
- Create: `test/fairness.test.js`

**Interfaces:**
- Produces: `normalizePaidState`, `createPaidContract`, `amendPaidContract`, `syncPaidEligibility`, `recordVerifiedPaidTrain`, `reorderPaidQueue`, `closePaidContract`.
- Produces: `normalizeOverrideState`, `setPriorityOnce`, `clearPriorityOnce`, `createSkip`, `clearSkip`, `isSkipped`, `expireOverrides`.
- Produces: `normalizeFairnessState`, `observeEligibilitySnapshot`, `recordFairnessTrain`, `fairnessScores`.

- [ ] **Step 1: Write failing paid-contract tests**

Cover exactly one active commitment per employee, FIFO order, manual reorder, additional purchase amendment, auto-pause/resume without order loss, verified-train decrement, bonus non-decrement, terminal completion, and explicit forfeiture/close outcomes.

Example assertion:

```js
test("verified paid train decrements remaining and completes at zero", () => {
  let state = createPaidContract(emptyPaidState(), {
    employeeId: 7,
    employeeName: "Alice",
    trainsPurchased: 1,
    createdAt: 100
  });
  state = recordVerifiedPaidTrain(state, 7, { timestamp: 200, countsTowardPaid: true });
  const contract = state.contractsById[state.activeByEmployeeId["7"]];
  assert.equal(contract.trainsRemaining, 0);
  assert.equal(contract.status, "completed");
});
```

- [ ] **Step 2: Verify paid-contract tests fail because module is missing**

Run: `node --test test/paid-contracts.test.js`

Expected: module-not-found failure.

- [ ] **Step 3: Implement paid-contract pure functions**

Persist terminal contracts in `contractsById`; `activeByEmployeeId` references only non-terminal agreements. Queue order is an array of contract IDs and must remain stable across auto-pause/resume.

- [ ] **Step 4: Write RED tests for Priority Once and Skip/Snooze**

Use explicit override state:

```js
{
  schemaVersion: 1,
  priorityOnceEmployeeId: null,
  skipsByEmployeeId: {}
}
```

`createSkip` must support `next_rotation`, `until_tomorrow`, `timed`, and `manual`. `isSkipped` receives `nowSeconds` and current verified-train counters so `next_rotation` can expire after one other recommendation cycle is consumed without touching training history.

- [ ] **Step 5: Implement overrides and verify tests pass**

- [ ] **Step 6: Write RED tests for Balanced Fairness**

Use observed eligibility snapshots and verified train events. Assert:

- an employee ineligible at an observation does not accrue expected share by default;
- opting into ineligible accrual includes them;
- a new employee only accrues from observed eligibility after the 72-hour gate;
- rolling-window pruning removes observations/events older than the configured window;
- output score is `expected - actual` and is deterministic.

- [ ] **Step 7: Implement fairness ledger and score calculation**

Use compact event records, not per-second accrual:

```js
{
  schemaVersion: 1,
  trackingStartedAt: 0,
  opportunities: [
    { timestamp: 0, eligibleEmployeeIds: [1, 2, 3], trainedEmployeeId: 2 }
  ]
}
```

Each verified train appends one opportunity using the trustworthy eligibility snapshot captured immediately before submission/verification. `fairnessScores()` filters opportunities to the rolling window and computes equal expected share for each included employee.

- [ ] **Step 8: Run targeted and full tests**

Run: `node --test test/paid-contracts.test.js test/overrides.test.js test/fairness.test.js`

Then: `npm test`

- [ ] **Step 9: Commit**

```bash
git add src/core/paid-contracts.js src/core/overrides.js src/core/fairness.js test/paid-contracts.test.js test/overrides.test.js test/fairness.test.js
git commit -m "feat: add paid training fairness and override domains"
```

---

### Task 3: Build one recommendation engine

**Files:**
- Create: `src/core/recommendation.js`
- Modify: `src/core/rotation.js`
- Create: `test/recommendation.test.js`
- Modify: `test/rotation.test.js` if present; otherwise add coverage in `test/recommendation.test.js`.

**Interfaces:**
- Consumes: employees, eligibilityById, trainingById, settings, paidState, overrideState, fairnessState, trainReceipts, current time.
- Produces: `buildTrainingRecommendation(input)` returning `{ ordered, nextEmployeeId, reasonById, sourceById, fairnessById, paidContractByEmployeeId, skipped }`.

- [ ] **Step 1: Write RED precedence tests**

Test paid > Priority Once > normal, pending receipt exclusion, skip exclusion, paid ineligible fall-through, Fair Rotation default, Balanced Fairness ordering, and manual eligible employee remaining trainable even when not recommended.

Example:

```js
assert.deepEqual(result.ordered.map((row) => row.id), [paidId, priorityId, balancedId]);
assert.equal(result.sourceById.get(paidId), "paid");
assert.equal(result.sourceById.get(priorityId), "priority_once");
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/recommendation.test.js`

- [ ] **Step 3: Implement `buildTrainingRecommendation` as a pure composition layer**

Do not place training write logic here. It may only rank/filter and explain.

Reason strings/codes must be stable enough for UI tests:

- `paid_priority`
- `priority_once`
- `never_trained`
- `oldest_last_train`
- `balanced_behind`
- `skipped`
- `pending_train_verification`
- `ineligible`

- [ ] **Step 4: Preserve `rankTrainingCandidates` compatibility**

Existing callers/tests using `rankTrainingCandidates` continue to work for Fair Rotation. New controller code uses `buildTrainingRecommendation`.

- [ ] **Step 5: Run targeted/full tests and commit**

```bash
node --test test/recommendation.test.js
npm test
git add src/core/recommendation.js src/core/rotation.js test/recommendation.test.js
git commit -m "feat: compose training recommendation precedence"
```

---

### Task 4: Persist new training state and safe backup/import

**Files:**
- Modify: `src/infra/storage.js`
- Create: `src/core/backup.js`
- Create: `test/storage-premium.test.js`
- Create: `test/backup.test.js`

**Interfaces:**
- Adds storage keys: `paidContracts`, `fairness`, `overrides`.
- Adds `load/savePaidContracts`, `load/saveFairness`, `load/saveOverrides`, `exportNonSecretState`, `importNonSecretState`.
- Backup import/export never includes API key unless a future explicit separately-reviewed design changes that rule.

- [ ] **Step 1: Write RED storage tests**

Assert malformed domains fall back safely, reset deletes new domains, and existing v1 data loads without migration failure.

- [ ] **Step 2: Implement domain storage with schema validation**

Use separate GM keys:

```js
paidContracts: "r4_tcm_paid_contracts",
fairness: "r4_tcm_fairness",
overrides: "r4_tcm_overrides",
backup: "r4_tcm_last_backup"
```

- [ ] **Step 3: Write RED backup tests**

Assert exported object contains no `apiKey`, `r4_tcm_api_key`, RFC/session fields, or raw authenticated data. Import must reject wrong schema and produce a preview before writes.

- [ ] **Step 4: Implement backup helpers**

`previewImport(payload)` returns validated domain names/counts. `applyImport(storage, payload)` first writes current non-secret export to `backup`, then applies validated domains sequentially.

- [ ] **Step 5: Verify and commit**

```bash
node --test test/storage-premium.test.js test/backup.test.js
npm test
git add src/infra/storage.js src/core/backup.js test/storage-premium.test.js test/backup.test.js
git commit -m "feat: persist premium training state safely"
```

---

### Task 5: Integrate domains into the controller and verified train lifecycle

**Files:**
- Modify: `src/app/controller-idempotency-base.js`
- Modify: `src/app/controller.js`
- Create: `test/controller-premium-training.test.js`
- Extend: `test/controller-audit.test.js`

**Interfaces:**
- Controller state gains `paid`, `fairness`, `overrides`, and `recommendation`.
- Adds actions: `createPaidAgreement`, `amendPaidAgreement`, `reorderPaidQueue`, `pausePaidAgreement`, `resumePaidAgreement`, `closePaidAgreement`, `setPriorityOnce`, `clearPriorityOnce`, `skipEmployee`, `clearSkip`, `getAttentionItems`.
- `trainEmployee(id, options = {})` accepts `countsTowardPaid` and captures recommendation source/eligibility snapshot in the persistent receipt metadata.

- [ ] **Step 1: Write RED controller initialization/recompute tests**

Assert new domains load, eligibility is synced into paid state, and `recommendation.nextEmployeeId` respects paid/priority/normal precedence.

- [ ] **Step 2: Implement state loading and recommendation recompute**

Extend `_recompute` to derive `recommendation` after eligibility/history are current. Keep existing `rotation` for compatibility, mapping it to the normal component rather than deleting it abruptly.

- [ ] **Step 3: Write RED verification-accounting tests**

Test a paid employee with one remaining train through the existing accepted -> awaiting -> verified path. Before verification remaining stays `1`; only after a matching new Company News event does it become `0` and terminal `completed`.

Also assert `countsTowardPaid:false` leaves paid balance unchanged while training history/fairness still record the verified train.

- [ ] **Step 4: Capture train classification in the persistent receipt before POST**

Receipt metadata must include only non-sensitive training context:

```js
{
  recommendationSource: "paid",
  countsTowardPaid: true,
  fairnessEligibleEmployeeIds: [1, 2, 3]
}
```

This survives reload/verification delay and prevents classification loss.

- [ ] **Step 5: On verified train, atomically update logical domains in safe order**

Order:

1. merge/save verified history;
2. record fairness opportunity from captured trustworthy snapshot;
3. decrement paid balance only when receipt says `countsTowardPaid === true` and a live applicable agreement exists;
4. consume Priority Once only when that exact employee receives the verified train;
5. expire next-rotation skip state as defined by override rules;
6. audit classification;
7. clear train receipt;
8. recompute recommendation.

If non-history auxiliary persistence fails after verification, preserve the receipt until reconciliation can complete rather than allowing a blind duplicate.

- [ ] **Step 6: Add paid/override mutation actions with audit events**

All mutations validate employee IDs and current state. No paid action performs a Torn payment or dismissal.

- [ ] **Step 7: Add attention derivation**

Create compact controller-derived attention items from stale/error state, unresolved receipts, paid auto-pauses, removal-threshold crossings, departed paid commitments, restorable pay, near-complete agreements, and expired skips. Filtering by notification mode happens after safety-critical items are derived.

- [ ] **Step 8: Run controller regression suite/full suite**

```bash
node --test test/controller-premium-training.test.js test/controller-audit.test.js test/train-idempotency.test.js test/train-preflight.test.js
npm test
```

Use actual existing test filenames discovered in the repository if the last two names differ.

- [ ] **Step 9: Commit**

```bash
git add src/app/controller-idempotency-base.js src/app/controller.js test/controller-premium-training.test.js test/controller-audit.test.js
git commit -m "feat: integrate paid and fair training lifecycle"
```

---

### Task 6: Redesign the main manager into the simple premium surface

**Files:**
- Modify: `src/ui/company-manager.js`
- Modify: `src/ui/styles.js`
- Create: `src/ui/employee-menu.js`
- Create: `src/ui/attention.js`
- Modify: `test/manager-ui.test.js`
- Create: `test/premium-manager-ui.test.js`

**Interfaces:**
- Main renderer consumes controller `recommendation`, `paid`, `overrides`, `attention`.
- Context actions call existing/new controller methods through `actions` passed by `main.js`.

- [ ] **Step 1: Write RED markup tests for minimal default surface**

Assert default HTML contains available trains, recommended employee, eligible count, one primary recommendation button, next-four queue preview, compact roster, Gear, health/attention controls; assert diagnostics JSON and full seven-column data are not present by default.

- [ ] **Step 2: Write RED interaction tests**

Assert Paid confirmation defaults `countsTowardPaid=true`, Bonus unchecks it, Priority Once and Skip actions dispatch correct callbacks, row detail expansion reveals secondary fields, and search/filter do not change underlying controller state.

- [ ] **Step 3: Implement premium semantic structure**

Use accessible buttons/menu labels and no inline secret data. Keep `actionFeedback` compact and preserve existing safety states.

- [ ] **Step 4: Implement restrained Voidsmith styling**

Use system UI stack, graphite layers, silver text, ember-red brand accents, semantic green/amber/red states, 120-180ms transitions, and `@media (prefers-reduced-motion: reduce)`.

Primary Train remains semantic positive, not brand red.

- [ ] **Step 5: Add mobile card layout**

At narrow width, hide desktop table headers and render/transform roster rows into touch-friendly cards with action targets >=44px. Do not inject Train controls beside Torn's native Fire control.

- [ ] **Step 6: Verify manager UI tests/full suite and commit**

```bash
node --test test/manager-ui.test.js test/premium-manager-ui.test.js
npm test
git add src/ui/company-manager.js src/ui/styles.js src/ui/employee-menu.js src/ui/attention.js test/manager-ui.test.js test/premium-manager-ui.test.js
git commit -m "feat: redesign premium training manager surface"
```

---

### Task 7: Replace the settings wall with progressive Gear sections and paid management

**Files:**
- Modify: `src/ui/settings.js`
- Create: `src/ui/paid-settings.js`
- Create: `src/ui/data-recovery.js`
- Create: `test/settings-ui-premium.test.js`
- Create: `test/data-recovery-ui.test.js`

**Interfaces:**
- Settings sections: General, Training Rules, Paid Trains, Fairness, Notifications, Appearance, Data & Recovery, Advanced.
- Only one section expands at a time.

- [ ] **Step 1: Write RED tests for sectioned settings**

Assert default first section only, advanced controls hidden until opened, hard policy displays 24h inactivity/72h new-hire hold, Balanced fields appear only when Balanced selected, Custom notifications reveal granular checkboxes only in Custom mode.

- [ ] **Step 2: Implement sectioned settings with validation**

Preserve API-key semantics. `removalThresholdDays` accepts `null`/off or a positive number; UI offers 2/3/7 and Custom without imposing a universal threshold.

- [ ] **Step 3: Implement paid-management settings**

Provide contract list, create/amend/pause/resume/reorder/close actions. Desktop drag handle may be used, but Up/Down controls must also exist for mobile/accessibility.

- [ ] **Step 4: Add Data & Recovery UI**

Export uses sanitized non-secret JSON. Import first previews validated domains, requires confirmation, and invokes controller/storage backup-before-apply flow.

- [ ] **Step 5: Move Audit/Diagnostics under Advanced**

The ordinary manager surface should expose them only through Gear -> Advanced, while preserving their existing functions.

- [ ] **Step 6: Verify and commit**

```bash
node --test test/settings-ui-premium.test.js test/data-recovery-ui.test.js test/audit-ui.test.js
npm test
git add src/ui/settings.js src/ui/paid-settings.js src/ui/data-recovery.js test/settings-ui-premium.test.js test/data-recovery-ui.test.js
git commit -m "feat: hide advanced training power behind gear"
```

---

### Task 8: Make the floating manager persistent across Job/Company and minimize fully into the launcher

**Files:**
- Modify: `src/main.js`
- Modify: `src/ui/manager-dock.js`
- Modify: `src/ui/company-manager.js`
- Modify: `src/ui/styles.js`
- Modify: `test/bootstrap.test.js`
- Create: `test/job-company-window.test.js`
- Extend: manager-dock tests present in `test/`.

**Interfaces:**
- Add `isJobCompanyArea(windowRef, documentRef)` route detector.
- `defaultMountCompanyUi` mounts floating manager on any Job/Company route.
- Dock launcher toggles current floating manager and remains available/re-attaches within Job/Company.

- [ ] **Step 1: Write RED route tests**

Cover `/companies.php?step=your`, company tabs/hash changes, and known Job/Company routes while rejecting unrelated Torn pages.

- [ ] **Step 2: Write RED window-state tests**

Assert resize/drag geometry persists, maximize stores/restores normal geometry, minimize sets `display:none` (or removes the floating root) for the entire panel, only compact dock remains, and clicking dock restores without recreation/state loss.

- [ ] **Step 3: Implement Job/Company route availability**

Change desired mode so Job/Company mounts the floating manager; unrelated routes may use the existing global badge only when enabled.

- [ ] **Step 4: Wire dock toggle to live manager handle**

The dock must not navigate away when a live Job/Company manager exists. Outside Job/Company it may continue to navigate to the company area.

- [ ] **Step 5: Ensure SPA observer reattaches launcher without repeated full DOM scans**

Keep the existing debounced mutation approach; observe only necessary sidebar/body changes and avoid per-mutation expensive scans.

- [ ] **Step 6: Verify/full suite and commit**

```bash
node --test test/bootstrap.test.js test/job-company-window.test.js
npm test
git add src/main.js src/ui/manager-dock.js src/ui/company-manager.js src/ui/styles.js test/bootstrap.test.js test/job-company-window.test.js
git commit -m "feat: persist training manager across company area"
```

---

### Task 9: Native training indicators, reminders, notification filtering, and PDA polish

**Files:**
- Create: `src/ui/native-indicators.js`
- Create: `src/core/notifications.js`
- Modify: `src/main.js`
- Modify: `src/ui/styles.js`
- Create: `test/native-indicators.test.js`
- Create: `test/notifications.test.js`

**Interfaces:**
- `mountNativeTrainingIndicators({ documentRef, state })` applies at most one training badge per Torn employee row and never adds a Train button near native Fire controls.
- `filterAttentionItems(items, settings)` implements Important/Everything/Silent/Custom while preserving blocking inline safety information.

- [ ] **Step 1: Write RED indicator tests**

Assert priority order for badges `NEXT > PAID > PRIORITY > PAUSED > INELIGIBLE`, one badge maximum per row, idempotent rerender, and no custom Train button insertion into native employee rows.

- [ ] **Step 2: Implement indicators behind `showNativeTrainingBadges`**

- [ ] **Step 3: Write RED notification-mode tests and implement filtering**

Important mode returns critical/action items; Everything returns all; Silent returns no optional attention items; Custom returns configured categories. Training write blockers remain visible inline through existing manager state regardless of notification mode.

- [ ] **Step 4: Add reminder helpers**

Generate concise inactive/addiction reminder text locally and expose Copy Reminder/Open Profile actions. Never send automatically.

- [ ] **Step 5: Verify/full suite and commit**

```bash
node --test test/native-indicators.test.js test/notifications.test.js
npm test
git add src/ui/native-indicators.js src/core/notifications.js src/main.js src/ui/styles.js test/native-indicators.test.js test/notifications.test.js
git commit -m "feat: add contextual training indicators and attention"
```

---

### Task 10: Release integrity, manual verification, and v1.2.0 docs

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Create: `docs/manual-verification.md`
- Modify: release/version tests as needed
- Generated: `dist/Torn Company Training Manager.user.js`

**Interfaces:**
- `package.json.version` remains release source of truth.
- Userscript header update/download/support URLs remain unchanged unless separately approved.

- [ ] **Step 1: Write/update release-integrity test expecting `1.2.0`**

The test must assert package version, built userscript `@version`, README current release, and no unresolved `__VERSION__` placeholder.

- [ ] **Step 2: Verify RED before changing package version**

Run the specific release test and confirm it fails because current version is `1.1.3`.

- [ ] **Step 3: Bump package version to `1.2.0` and update README/CHANGELOG**

Document only implemented/verified behavior. Do not claim TornPDA compatibility as verified until manual/live verification evidence exists; describe responsive/PDA-targeted support accurately if only automated/jsdom evidence is available.

- [ ] **Step 4: Create live manual verification checklist**

Checklist must include:

- install/update from built artifact;
- API key setup;
- 72h new-hire boundary;
- paid create/amend/reorder/pause/resume/complete/bonus;
- Fair/Balanced ordering;
- Priority Once and Skip/Snooze;
- Job/Company cross-route launcher persistence;
- resize/maximize/minimize/restore/reload geometry;
- stale/unverified fail-closed writes;
- accepted-but-unverified duplicate lock;
- payroll dock/restore regression;
- export/import without API key;
- desktop and TornPDA/mobile visual/touch checks;
- Torn SPA sidebar replacement/reattach.

- [ ] **Step 5: Run final build and full verification**

```bash
npm run check
```

Expected: build succeeds and entire Node test suite passes with zero failures.

- [ ] **Step 6: Inspect generated userscript metadata and working tree**

```bash
head -n 20 "dist/Torn Company Training Manager.user.js"
git status --short
git diff --check
```

- [ ] **Step 7: Commit release candidate**

```bash
git add package.json README.md CHANGELOG.md docs/manual-verification.md dist test src
git commit -m "release: prepare Training Manager 1.2.0"
```

## Plan self-review

- Spec coverage: every acceptance criterion maps to Tasks 1-10.
- Placeholders: no implementation step uses TBD/TODO or unspecified error-handling language.
- Type consistency: the plan uses one controller `recommendation` state, one verified history source, `countsTowardPaid` receipt metadata, and separate paid/fairness/override storage domains consistently.
- Scope: finance/inventory/advertising/backend features remain explicitly excluded.
