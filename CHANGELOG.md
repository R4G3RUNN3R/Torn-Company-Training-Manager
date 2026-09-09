# Changelog

All notable changes to Torn Company Training Manager are documented here.

## [1.1.2] - 2026-09-09

### Added

- Row-based payroll diagnostics for the employee involved in the current action, including employee-row presence, `.pay input` count, native Submit Changes control count, dirty employee IDs, and API wage-coverage health.
- Regression coverage for payroll pages that do not expose one unique page-level form.
- Cache-bust support for employee API reads used to verify payroll changes.

### Changed

- Dock Pay and Restore Pay now target the exact Torn employee row and its native `.pay input` rather than relying on a unique page-level payroll form.
- Payroll submission now uses Torn's native wage-field `input`, `change`, and `blur` events followed by exactly one enabled **SUBMIT CHANGES** control.
- Payroll verification uses cache-busted employee API reads while a Dock/Restore action is pending, avoiding false `unverified` results caused by stale Torn API responses.
- Payroll diagnostics expose structural/dirty-state health without exposing wage values.

### Fixed

- Fixed `payroll_form_not_unique` preventing Dock Pay on Torn's current employee-page layout.
- Prevented payroll actions from overwriting an unsaved wage edit already present in the target employee field.
- Prevented payroll actions from submitting when another visible employee has an unrelated unsaved/dirty wage field.
- Prevented a successful Torn wage change from being incorrectly reported as unverified merely because a cached employee response still contained the old wage.
- Payroll actions continue to fail closed when the exact employee row, wage input, API wage snapshot, or unique Submit Changes control cannot be verified.

## [1.1.1] - 2026-09-09

### Added

- Persistent train-attempt receipts stored in Tampermonkey storage for unresolved training actions.
- Fresh preflight checks immediately before every training POST, covering roster, eligibility, available train count, and newer Company News.
- Cross-tab train ownership with unique attempt IDs and a shared-storage settle check so simultaneous same-employee attempts from this userscript do not both reach Torn.
- Explicit UI states for **Train Pending Verification**, preflight state changes, and unknown submission outcomes.
- Diagnostics for pending train-receipt count and sanitized receipt states.
- Audit phases for training preflight, pending-receipt blocks, and unknown submission outcomes.

### Changed

- Pending/unverified employees are excluded from the training rotation until matching Company News reconciles the receipt.
- Pending train locks survive Refresh, page reloads, navigation, and other open tabs.
- The direct training POST no longer depends on Torn's native Train button remaining present or unique in the DOM; native controls are diagnostic only.
- Direct training still fails closed unless the script is on Torn company management, the exact employee row exists, and a current RFC token is available.
- Before spending a train, stale recommendations caused by another trainer or userscript are aborted and recalculated.

### Fixed

- Fixed the v1.1.0 bug where a successful Refresh cleared the in-memory `accepted_unverified` duplicate guard.
- Fixed duplicate protection being lost after page reload or in another tab.
- Fixed a same-second cross-tab race where two controllers could previously generate the same local train-attempt identifier.
- Reduced interference from userscripts that modify or replace Torn's native Train controls.
- Prevented a blind retry when a training POST has an unknown outcome; the employee remains locked until verification resolves it.

### Known limitation

- A completely separate userscript can still independently issue its own Torn training request. Torn's training endpoint does not expose a client idempotency key, so unrelated scripts posting at the exact same instant cannot be made transactionally impossible by this userscript alone. Avoid enabling overlapping automatic company-training features in multiple scripts simultaneously.

## [1.1.0] - 2026-09-08

### Added

- Local-only **Audit Log** for training, pay docking/restoration, refresh failures, history rebuilds, and settings changes.
- Rolling retention of the latest 500 audit entries.
- Audit filters by action, result, employee name, or Torn ID.
- Copy-visible-log, JSON export, and confirmation-gated audit clearing.
- **Diagnostics / Self-Test** panel with controller, history, audit, page-integration, and training-action health information.
- Copy Diagnostics action with recursive credential/session redaction.
- Explicit userscript `@updateURL`, `@downloadURL`, and `@supportURL` metadata.
- Release-integrity tests to keep package, userscript, README, and metadata versions aligned.

### Changed

- Training now uses Torn's exact user-triggered company training POST instead of synthetic mouse events on the native Train control.
- Training transport validates the exact employee target and requires the current Torn RFC token before submitting.
- Training verification now distinguishes Torn acceptance from Company News/API verification.
- Accepted trains receive one immediate Company News check, then a 31-second cache-aware retry with a unique API timestamp before being classified as `accepted_unverified`.
- Duplicate training retries are blocked while a prior accepted train is still unverified.
- `package.json` is now the single source of release-version truth; the build injects that version into userscript metadata.

### Fixed

- Avoids treating an accepted Torn training request as failed merely because Torn's Company News/API cache has not refreshed within a few seconds.
- Avoids silently succeeding or fabricating local history from the training POST response alone.
- Prevents raw RFC values, API keys, authorization headers, cookies, session values, and authenticated response bodies from entering the Audit Log or Diagnostics output.
- Corrects README release-version drift by tying release checks to the package version.

## [1.0.6] - 2026-09-07

### Fixed

- Improved Company -> Employees route detection when Torn keeps the Employees tab active without legacy URL state.
- Improved native Torn employee-row and Train-control detection using exact employee IDs and current button-based controls.
- Surfaced failed and unverified Train results instead of letting them disappear silently.

## [1.0.4] - 2026-09-07

### Changed

- Training inactivity policy uses actual `last_action.timestamp` with a fixed 24-hour cutoff.
- Added high-contrast manager text/statuses.
- Added movable, resizable, minimizable and maximizable manager-window behavior.
- Replaced the text Settings control in the full manager header with a gear icon.
