# Changelog

All notable changes to Torn Company Training Manager are documented here.

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
