# v1.2.2 Training Submission Route Root Cause

## FACT

Live Torn testing on 2026-09-12 showed the Training Manager UI mounted on the current Job/Company employees route and allowed the director to click Train, but the selected employee was not trained and no matching Company News event appeared.

The manager then displayed `Training outcome unknown. Do not retry; verification lock is active.` and retained a pending verification receipt.

## Root cause

`src/main.js` intentionally treats current Torn company routes such as `https://www.torn.com/companies.php#/option=employees` as Job/Company pages. However, `CompanyPageActions.#isCompanyManagementPage()` still accepts only `/companies.php?step=your...`.

Therefore, on a modern hash-only company route:

1. UI mounts and preflight succeeds.
2. Controller reserves a persistent train receipt.
3. `CompanyPageActions.submitTrain()` returns `{ status: "unsafe_dom", reason: "not_company_management_page" }` before any POST is sent.
4. Controller currently classifies every non-accepted/non-rejected submission result as `submission_unknown` and intentionally retains the receipt.
5. The employee is locked for verification even though the request never crossed the write boundary.

## Correct behavior

- Current Torn Job/Company routes accepted by the UI must also be accepted by the training write guard, while unrelated Torn pages remain blocked.
- A result that proves the request was blocked before submission (`unsafe_dom`) must clear the reserved receipt and surface a normal failed/blocked action. It must not create an unknown-outcome lock.
- Actual ambiguous post-boundary failures (`network_error`, invalid/unrecognized response after POST, HTTP failure where server handling cannot be ruled out) remain fail-closed as `submission_unknown`.

## Safety

This fix does not weaken employee targeting, RFC token checks, same-origin enforcement, explicit user confirmation, train preflight, Company News verification, duplicate prevention, or cross-tab receipt ownership.
