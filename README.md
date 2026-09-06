# Torn Company Training Manager

Tampermonkey userscript for Torn company directors.

It manages a fair employee training rotation while enforcing configurable inactivity and addiction rules, reconstructs training history from Company News, and provides guarded payroll docking/restoration controls.

## Install

Open the raw userscript and let Tampermonkey install it:

`https://raw.githubusercontent.com/R4G3RUNN3R/Torn-Company-Training-Manager/main/dist/Torn%20Company%20Training%20Manager.user.js`

## Default policy

- Inactivity threshold: 3 days
- Maximum addiction: 3
- Employees above either configured threshold are excluded from training
- Never-trained eligible employees are prioritised
- Otherwise, the eligible employee with the oldest last-training time is next
- Training, pay docking, and pay restoration always require explicit director action
- Unknown or stale eligibility data fails closed

## Development

```bash
npm test
npm run build
```

The production userscript is built to `dist/Torn Company Training Manager.user.js`.

See `docs/manual-verification.md` for the live Torn verification checklist.

## License

MIT
