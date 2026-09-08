# Torn Company Training Manager

Tampermonkey userscript for Torn company directors.

**Current release: v1.1.0**

It manages a fair employee training rotation while enforcing a fixed last-action inactivity rule and configurable addiction rule, reconstructs training history from Company News, provides guarded payroll docking/restoration controls, and now includes local diagnostics and an action audit trail.

## Install / Update

Open the raw userscript and let Tampermonkey install or update it:

`https://raw.githubusercontent.com/R4G3RUNN3R/Torn-Company-Training-Manager/main/dist/Torn%20Company%20Training%20Manager.user.js`

Version 1.1.0 declares explicit Tampermonkey update/download metadata pointing to that production file, so future version checks use the same main-branch userscript URL.

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

A Train click in the manager remains explicitly confirmation-gated. After confirmation, v1.1.0 targets the exact Torn employee and submits Torn's company training action as a same-origin POST using the current page's RFC token.

The script separates these states rather than pretending one response proves everything:

- **Pending**: training request is being submitted
- **Accepted**: Torn accepted the request
- **Awaiting verification**: the script is waiting for Torn's Company News/API cache before checking again
- **Verified**: a new training-news event for the exact employee was found
- **Accepted, unverified**: Torn accepted the request but Company News has not confirmed it yet; duplicate retry is blocked until refresh/manual verification
- **Rejected / Failed**: Torn rejected the action or the request could not be safely submitted

The script never invents a local training-history event merely because a POST returned success.

## Audit Log

The full manager includes an **Audit Log** for operational history. It is stored only in Tampermonkey/local userscript storage and retains the latest 500 entries.

It records sanitized events for:

- training requests and results
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
- training-history counts
- audit-storage status
- employee-page/train-control detection
- whether an RFC token is present, without exposing its value

**Copy Diagnostics** produces a sanitized block suitable for troubleshooting.

## Manager window

The Company Training Manager window can be dragged, resized, minimized and maximized. Normal position and size, plus minimized/maximized state, are stored locally in Tampermonkey storage and restored on refresh.

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
