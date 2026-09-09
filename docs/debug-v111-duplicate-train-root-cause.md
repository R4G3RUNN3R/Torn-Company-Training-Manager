# v1.1.1 duplicate-train / auto-train root-cause investigation

Date: 2026-09-09

## Reported symptom

- Clicking Train inside Torn Company Training Manager still appears unreliable.
- Two company trains were spent on the same employee.
- Other company-management userscripts may be active on the same Torn page.

## Confirmed root causes in v1.1.0

1. `TrainingManagerController` keeps unresolved accepted trains only in the in-memory `unverifiedTrainIds` Set.
2. Every successful `refresh()` calls `this.unverifiedTrainIds.clear()`, even when Company News has not confirmed the accepted train.
3. A page reload/new controller instance also loses `unverifiedTrainIds`, so duplicate protection is not durable or cross-tab.
4. `trainEmployee()` does not perform a fresh preflight training-news/profile check immediately before the POST. An external training action can therefore make the manager's recommendation stale between normal refreshes.
5. `submitTrain()` unnecessarily requires Torn's native Train DOM control even though the direct training request only needs a validated employee target, Torn company-page context, an RFC token, and the established `trainemp2` POST. A userscript/Torn DOM mutation can therefore prevent the manager's own Train action from reaching the POST boundary.

## External-script evidence

Pythagoras Project - CIS is capable of independently resolving and clicking Torn's native Train control from its own training queue. This establishes a legitimate second training writer on the same company page when enabled. It does not prove that Pythagoras caused the reported duplicate.

A public Torn Company Trainer implementation also confirms the established request shape:

- POST `https://www.torn.com/companies.php?rfcv=<RFC>`
- body: `step=trainemp2`, `ID=<employee id>`

## Fix direction

- Persist unresolved accepted-train receipts in Tampermonkey storage.
- Never clear a receipt merely because refresh succeeded.
- Reconcile receipts only against matching Company News evidence.
- Reload receipts before every training write so reloads/tabs share the duplicate guard.
- Perform a cache-busted preflight refresh immediately before the POST and abort/recompute on externally changed training state.
- Make native Train-control discovery diagnostic rather than a hard POST prerequisite once company context, current roster, eligibility, trains, RFC and receipt checks pass.
- Expand Audit Log phases around preflight and duplicate blocking.
