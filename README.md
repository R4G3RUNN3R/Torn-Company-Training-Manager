# Torn Company Training Manager

Tampermonkey userscript for Torn company directors, focused specifically on company training.

**Current release: v1.2.0**

The manager combines a guarded training queue, paid-train commitments, fair rotation modes, temporary director overrides, training-focused notifications, local recovery tools, and the existing verified training/payroll safety model. It deliberately does not attempt to become a general company ERP.

## Install / Update

Open the production userscript and let Tampermonkey install or update it:

`https://raw.githubusercontent.com/R4G3RUNN3R/Torn-Company-Training-Manager/main/dist/Torn%20Company%20Training%20Manager.user.js`

The userscript `@updateURL` and `@downloadURL` point to the same main-branch production file.

## First-run setup

Configuration is available from the manager gear icon, the compact/global launcher when enabled, or Tampermonkey's **Company Training Manager: Settings** menu command.

The settings UI is intentionally progressive rather than one giant control wall. Ordinary operation uses sensible defaults, while training rules, paid trains, fairness, notifications, appearance, recovery, audit and diagnostics remain behind the gear menu.

The Torn API key is stored in userscript-manager storage and is not included in backup exports. Authenticated values such as the API key, RFC token, cookies and raw authenticated response bodies are excluded from audit/diagnostic output.

## Training policy

Default eligibility rules are:

- more than 24 hours since `last_action.timestamp` is inactive
- exactly 24 hours remains eligible
- new hires are held from company training until exactly 72 hours / 3 days in the company
- maximum addiction is 3 by default
- missing, stale or otherwise unverifiable eligibility data fails closed
- training, pay docking and pay restoration require explicit director action

The manager never auto-fires employees, never runs unattended training chains, and never lets a paid commitment bypass the company's activity/addiction eligibility rules.

## Recommendation order

The primary recommendation follows this precedence:

1. first eligible active **Paid Train** commitment in the director-controlled paid queue
2. an eligible **Priority Once** employee
3. the selected normal rotation mode

Directors may still manually train another eligible employee. Recommendations guide the workflow; they do not remove director control.

### Fair Rotation

This is the default normal mode. Never-trained eligible employees are prioritised first. Otherwise, the employee with the oldest verified last-training time is next.

### Balanced Fairness

Balanced Fairness uses a rolling fairness ledger rather than pretending historical eligibility is known. The default window is 30 days, with configurable 7 / 14 / 30 / 60 / 90 day or custom windows.

By default, an employee does not accrue fairness debt while ineligible. Directors may explicitly enable debt accrual during ineligible periods. Fairness tracking exposes its trustworthy tracking start instead of fabricating eligibility history from before the script observed it.

## Paid trains

Paid trains are a first-class training feature, not an accounting system.

- paid agreements are FIFO by default and may be explicitly reordered by the director
- one employee cannot have two simultaneous active paid commitments
- additional purchases amend the active agreement instead of creating a duplicate active contract
- ineligible paid employees automatically pause without losing their remaining balance or queue position
- eligibility restoration automatically returns an auto-paused agreement to the paid queue
- directors may manually pause/resume an agreement
- a paid balance decreases only after independent Company News verification confirms the exact training event
- a manually triggered train for an employee with an active paid agreement counts toward the commitment by default
- the director can mark that train as a **Bonus Train**, which keeps the paid balance unchanged while still recording the real training event for normal history/fairness
- completed, cancelled and forfeited agreements keep explicit terminal outcomes

The optional price/reference fields are informational training-contract metadata only. The script does not verify payments or act as a finance ledger.

A director-configurable prolonged-noncompliance threshold can surface a paid employee as removal-eligible. Suggested thresholds include 2, 3 and 7 days, with custom values supported. The script never removes the employee automatically.

## Priority Once and Skip / Snooze

**Priority Once** temporarily moves one eligible employee ahead of normal rotation and is consumed only after that employee receives a verified train.

Skip/Snooze can temporarily remove an employee from recommendation without changing their underlying training history. Supported behavior includes next-rotation, until-tomorrow, timed and manual-until-cleared skips.

## Training reliability

Every Train action remains confirmation-gated. Before Torn is asked to spend a train, the controller performs a fresh preflight against current roster/eligibility, train count and newer Company News. If relevant state changed, the operation aborts and recalculates instead of blindly using a stale recommendation.

Training targets the exact employee and submits Torn's company training action as a same-origin request using the current page RFC token. The script separates acceptance from verification:

- **Preflight**: current state is being checked
- **Pending**: a persistent train receipt owns the attempt
- **Accepted**: Torn accepted the request
- **Awaiting verification**: Company News/API confirmation is pending
- **Verified**: the exact training event was independently found
- **Accepted, unverified**: Torn accepted it but confirmation is not yet available; the employee remains locked
- **Submission unknown**: the outcome cannot be proven; the employee remains locked to prevent a blind duplicate retry
- **Rejected / Failed**: Torn rejected the request or safe submission could not be established

Unresolved receipts persist through refreshes, reloads and other open tabs. Same-userscript instances use attempt ownership and shared-storage settlement to prevent both from crossing the Torn POST boundary for the same employee. The script never invents training history merely because an HTTP request returned success.

A completely separate userscript can still independently issue its own Torn training request. Torn does not expose a client idempotency key for this action, so unrelated scripts submitting at the same instant cannot be made transactionally impossible from this script alone.

## Manager UI and Torn routes

The full Training Manager is available in Torn's Job / Company area, including both current hash-style routes such as `companies.php#/option=employees` and older `?step=your` routes.

The manager is movable, fully resizable, maximizable and minimizable. Position, size and window state are stored locally. Minimizing hides the full window into the compact Training Manager dock/launcher rather than leaving a large collapsed panel on screen.

The default surface stays deliberately small: train availability, eligibility summary, the current recommended employee, one obvious primary action and a short queue preview. Employee-specific power such as paid agreements, Priority Once, skip, reminder copy and payroll actions is contextual rather than permanently displayed.

On the native Employees page, compact training badges may show states such as **NEXT**, **PAID**, **PRIORITY**, **PAUSED**, **NEW HIRE** or **INELIGIBLE**. The script does not place its own frequent Train control beside Torn's destructive Fire control.

The dock watches Torn's SPA DOM and reattaches when the status/sidebar area is replaced. If that area is temporarily unavailable, a small fallback launcher is used.

The interface includes responsive rules intended for narrow/mobile/TornPDA-sized layouts. Live device behavior remains part of the manual release checklist.

## Notifications and reminders

Training-focused attention items support **Important only** by default, plus Everything, Silent and configurable Custom modes. Notifications are local UI signals, not background messaging.

For inactive/addiction/new-hire cases the employee menu can generate concise reminder text for the director to copy. It does not send messages automatically.

## Payroll reliability

Dock Pay and Restore Pay target the exact Torn employee row by Torn ID and require the expected native wage controls. The script compares visible wage fields against a fresh API snapshot and fails closed if unrelated unsaved wage edits are present.

When checks pass, the script updates the exact target field using Torn-compatible `input`, `change` and `blur` events, submits exactly one native **Submit Changes** control, then verifies the resulting wage through cache-busted API reads before recording the action as verified.

## Audit, diagnostics and local recovery

Audit and Diagnostics are intentionally kept behind **Gear -> Advanced** rather than occupying the ordinary manager surface.

The local audit trail retains the latest 500 sanitized operational entries and supports filtering, copy/export and confirmation-gated clearing. Diagnostics expose controller, training-receipt, history, page-integration and payroll-control health without exposing credential values.

**Data & Recovery** supports local non-secret export/import, history rebuild and local reset. Backup export excludes the Torn API key. Import validates the backup schema and stores a local backup of the existing non-secret state before replacing supported domains.

## Development and release integrity

`package.json` is the release-version source of truth. The build injects that version into `dist/Torn Company Training Manager.user.js`, and release tests keep userscript metadata, README and changelog aligned.

Every branch push and pull request runs the production build and automated test suite through GitHub Actions.

```bash
npm run check
```

See `CHANGELOG.md` for release notes and `docs/manual-verification.md` for the live Torn verification checklist.

## License

MIT
