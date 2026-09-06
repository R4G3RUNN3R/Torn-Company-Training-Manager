# Torn Company Training Manager

Tampermonkey userscript for Torn company directors.

It manages a fair employee training rotation while enforcing configurable inactivity and addiction rules, reconstructs training history from Company News, and provides guarded payroll docking/restoration controls.

## Install

Open the raw userscript and let Tampermonkey install/update it:

`https://raw.githubusercontent.com/R4G3RUNN3R/Torn-Company-Training-Manager/main/dist/Torn%20Company%20Training%20Manager.user.js`

## First-run setup

Version 1.0.2 and later provides several independent ways to reach configuration:

1. On the global Torn badge, click **Set API Key** when no key is configured. Once configured, the same control is labelled **Settings**.
2. On Company -> Employees, use the full **Company Training Manager** panel and its **Settings** button.
3. As a fallback, open Tampermonkey's menu for the page and choose **Company Training Manager: Settings**. This remains available even if the global badge is disabled.

The settings window contains the Torn API key field, inactivity threshold, addiction threshold, refresh interval, badge options, history rebuild, API-key clearing and local-data reset controls.

## Default policy

- Inactivity threshold: 3 days
- Maximum addiction: 3
- Employees above either configured threshold are excluded from training
- Never-trained eligible employees are prioritised
- Otherwise, the eligible employee with the oldest last-training time is next
- Training, pay docking, and pay restoration always require explicit director action
- Unknown or stale eligibility data fails closed

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
