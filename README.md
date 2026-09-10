# Torn Company Training Manager

Tampermonkey userscript for Torn company directors.

**Current release: v1.1.3**

It manages a fair employee training rotation while enforcing a fixed last-action inactivity rule and configurable addiction rule, reconstructs training history from Company News, provides guarded payroll docking/restoration controls, and includes local diagnostics and an action audit trail.

## Install / Update

Open the raw userscript and let Tampermonkey install or update it:

`https://raw.githubusercontent.com/R4G3RUNN3R/Torn-Company-Training-Manager/main/dist/Torn%20Company%20Training%20Manager.user.js`

Explicit Tampermonkey update/download metadata points to that production file, so future version checks use the same main-branch userscript URL.

## First-run setup

Several independent ways remain available to reach configuration:

1. On the global Torn badge, click **Set API Key** when no key is configured. Once configured, the same control opens Settings.
2. On Company -> Employees, use the gear icon in the full **Company Training Manager** window.
3. As a fallback, open Tampermonkey's menu for the page and choose **Company Training Manager: Settings**. This remains available even if the global badge is disabled.

The settings window contains the Torn API key field, addiction threshold, refresh interval, badge options, history rebuild, API-key clearing and local-data reset controls. The inactivity rule is fixed: more than 24 hours since the employee's last action makes them ineligible for training.

## Default policy

- Inactivity: more than 24 hours since `last_action.timestamp`
- Exactly 24 hours is still eligible; anything beyond 24 hours is inactive
- Maximum addiction: 3
- Employees failing either rule are excluded from training and have no Train control in the manager
- Never-trained eligible employees are prioritised
- Otherwise, the eligible employee with the oldest last-training time is next
- Training, pay docking, and pay restoration always require explicit director action
- Unknown or stale eligibility data fails closed

## Training reliability

A Train click in the manager remains explicitly confirmation-gated. After confirmation, v1.1.2 performs a fresh preflight of the company roster, eligibility, available train count and newer Company News before it sends anything. If another trainer or script changed the training state since the manager snapshot, the action is aborted and the recommendation is recalculated instead of spending a stale train.

The direct training request targets the exact Torn employee and submits Torn's company training action as a same-origin POST using the current page's RFC token. It no longer depends on Torn's native Train button remaining untouched in the DOM, which reduces interference from other userscripts that alter company controls.

The script separates these states rather than pretending one response proves everything:

- **Preflight**: fresh company/training state is being checked
- **Pending**: a persistent train receipt has been acquired and the request is being submitted
- **Accepted**: Torn accepted the request
- **Awaiting verification**: the script is waiting for Torn's Company News/API cache before checking again
- **Verified**: a new training-news event for the exact employee was found
- **Accepted, unverified**: Torn accepted the request but Company News has not confirmed it yet; that employee remains locked across refreshes, page reloads and other open tabs until verification succeeds
- **Submission unknown**: the request outcome could not be proven; the employee remains locked to prevent a blind duplicate retry
- **Rejected / Failed**: Torn rejected the action or the request could not be safely submitted

Unresolved train receipts are stored locally in Tampermonkey storage, excluded from the rotation, and reloaded before every new training write. Concurrent instances of this userscript use unique attempt ownership and a shared-storage settle check so simultaneous same-employee attempts do not both cross the Torn POST boundary.

The script never invents a local training-history event merely because a POST returned success.

### Other training userscripts

v1.1.2 protects this manager against its own refresh/reload/tab races and checks for external training changes immediately before submission. A completely separate userscript can still independently issue its own Torn training action. Torn's endpoint does not provide a client-supplied idempotency key, so two unrelated scripts posting at the exact same instant cannot be made transactionally impossible from this userscript alone. Avoid enabling overlapping automatic company-training features in multiple scripts at the same time.

## Payroll reliability

v1.1.2 no longer assumes Torn exposes one unique page-level payroll form. Dock Pay and Restore Pay target the exact employee row by Torn ID and require exactly one enabled `.pay input` in that row.

Before changing anything, the script compares visible wage fields with the fresh API wage snapshot. If the target wage field or any other employee wage field already contains an unsaved change, the payroll action fails closed rather than overwriting that edit or submitting multiple wage changes together.

Only after those checks pass does the script set the target field, dispatch Torn-compatible `input`, `change`, and `blur` events, and click exactly one enabled native **SUBMIT CHANGES** control. The controller then verifies the actual wage through cache-busted employee API reads while Dock/Restore is pending, with short retries if Torn has not applied the change immediately. A payroll action is recorded as verified only when the API reflects the requested wage.

## Audit Log

The full manager includes an **Audit Log** for operational history. It is stored only in Tampermonkey/local userscript storage and retains the latest 500 entries.

It records sanitized events for:

- training preflight, requests and results
- duplicate/pending-receipt blocks
- pay docking/restoration requests and results
- refresh failures
- training-history rebuild results
- policy/settings changes

The Audit Log can be filtered by action, result, employee name or Torn ID. Visible entries can be copied or exported as JSON. Clearing the log requires confirmation.

The log deliberately does **not** store Torn API keys, RFC-token values, cookies/session data, authorization headers, or raw authenticated response bodies.

## Diagnostics / Self-Test

Company -> Employees also includes a collapsible **Diagnostics / Self-Test** section with sanitized runtime information such as:

- controller freshness/status and last update
- current trains and employee/eligibility counts
- current training action state
- pending train-receipt count/state
- training-history counts
- audit-storage status
- employee-page/train-control detection
- payroll employee-row detection, wage-input count, Submit Changes control count, dirty employee IDs, and API wage-coverage health
- whether an RFC token is present, without exposing its value

Payroll diagnostics deliberately report control/employee health rather than wage values.

**Copy Diagnostics** produces a sanitized block suitable for troubleshooting.

## Manager window and Torn sidebar dock

The Company Training Manager window can be dragged, resized and maximized. Its normal position and size are stored locally in Tampermonkey storage and restored on refresh.

v1.1.3 adds an always-visible **Training Manager dock icon** to Torn's status/sidebar icon area. The dock remains available while the manager is open and while it is minimized. On Company -> Employees, clicking the dock toggles the full manager between open and minimized states. Minimizing now hides the full floating window completely instead of leaving a wide 64px shell on screen, while preserving the saved geometry for restoration.

The dock shows a small status indicator: green when trains are available, amber for pending/unverified training states, red for stale/API errors, and neutral when idle. Its tooltip includes the available train count and next employee when known.

Because Torn redraws parts of its interface during SPA navigation, the dock watches for DOM replacement and reattaches itself when the status area is recreated. If Torn's status/sidebar area cannot be found temporarily, a small fallback launcher is shown instead. Outside the Company Employees page, the dock opens the Company Employees manager page.

## Development and release integrity

`package.json` is the release-version source of truth. The build injects that version into the userscript metadata and release tests verify that the production userscript, README and update metadata remain aligned.

Every branch push and pull request runs the production build and test suite through GitHub Actions.

```bash
npm run build
npm test
```

The production userscript is built to `dist/Torn Company Training Manager.user.js`.

See `CHANGELOG.md` for release notes and `docs/manual-verification.md` for the live Torn verification checklist.

## License

MIT
