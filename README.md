# Torn Company Training Manager

Tampermonkey userscript for Torn company directors.

**Current release: v1.0.4**

It manages a fair employee training rotation while enforcing a fixed last-action inactivity rule and configurable addiction rule, reconstructs training history from Company News, and provides guarded payroll docking/restoration controls.

## Install

Open the raw userscript and let Tampermonkey install/update it:

`https://raw.githubusercontent.com/R4G3RUNN3R/Torn-Company-Training-Manager/main/dist/Torn%20Company%20Training%20Manager.user.js`

## First-run setup

Version 1.0.2 and later provides several independent ways to reach configuration:

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

## Manager window

The Company Training Manager window can be dragged, resized, minimized and maximized. Normal position and size, plus minimized/maximized state, are stored locally in Tampermonkey storage and restored on refresh.

## Development

Every branch push and pull request runs the test suite and production build through GitHub Actions.

```bash
npm test
npm run build
```

The production userscript is built to `dist/Torn Company Training Manager.user.js`.

See `docs/manual-verification.md` for the live Torn verification checklist.

## License

MIT
