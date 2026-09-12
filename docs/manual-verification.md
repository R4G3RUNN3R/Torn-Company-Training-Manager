# Torn Company Training Manager v1.2.3 Manual Verification

This checklist covers behavior that automated unit/integration tests cannot prove against Torn's live UI, account state, browser userscript environment or TornPDA.

Do not mark the release manually verified unless each applicable item has been observed directly. If a step cannot safely be exercised on the current company/account, record it as **Not exercised** rather than inventing evidence.

## Preconditions

- Install the production-built `dist/Torn Company Training Manager.user.js` in Tampermonkey or the supported userscript environment.
- Confirm the installed userscript reports version `1.2.3`.
- Disable overlapping company-training automation in unrelated userscripts during verification.
- Use an API key with only the Torn access required by the Training Manager.
- Keep a known-good prior userscript available for rollback if a production-sensitive write path behaves unexpectedly.

## 1. Install, startup and routes

- Reload Torn after installation.
- Confirm the Training Manager launcher/dock appears.
- Open Job / Company using Torn's current navigation and confirm the full manager appears immediately unless the saved state is minimized.
- Verify current hash-style routes such as `companies.php#/option=employees` are recognised.
- Verify older `companies.php?step=your` company routes still work when reachable.
- If upgrading from v1.2.1 after the known `not_company_management_page` false-lock defect, confirm that exact legacy fake verification lock clears after initialization rather than remaining stuck forever.
- Navigate between Company tabs without a full page reload and confirm there is no duplicate manager, duplicate dock or orphaned fallback launcher.
- Confirm Torn SPA redraws do not permanently remove the launcher; it should reattach when the status/sidebar area is recreated.

## 2. First-run and API-key behavior

- With no API key configured, confirm settings remain reachable and the UI clearly requests an API key.
- Enter a valid director-capable key and refresh data.
- Confirm employee/training data loads without exposing the key in visible diagnostics or audit output.
- Clear the key and confirm privileged/data-dependent operations fail closed.
- Re-enter the key before continuing.

## 3. Window, lock and launcher behavior

- With no prior manager-window state, enter Job / Company and confirm the manager opens near the top-right of the viewport in **locked** mode.
- Confirm the header lock control shows the locked vector state while locked.
- Attempt to drag the locked manager and confirm its position does not change.
- Resize the locked manager and confirm resizing remains available.
- Click the lock control and confirm it changes to the unlocked vector state and dragging becomes available.
- Move the unlocked manager to a different position and confirm normal resizing still works.
- Re-lock at the new position and confirm the manager remains at that position rather than snapping back to the top-right.
- Reload Torn and return to Job / Company; confirm lock/unlock state, normal position and dimensions are restored.
- Maximize and restore it; confirm the saved normal geometry remains intact.
- Minimize it and confirm the full floating window disappears completely, leaving only the compact Voidsmith vector launcher.
- Restore it from the launcher.
- Reload while minimized and confirm the manager remains minimized to the launcher rather than opening a second full window.
- Confirm the window stays within the usable viewport after a browser-size change.
- Confirm the launcher uses the Voidsmith Training Manager glyph and displays the appropriate ready/warning/error status dot rather than the old `T◆` text treatment.

## 4. Eligibility boundaries

- Confirm an employee at more than 24 hours since last action is marked inactive/ineligible.
- Confirm exactly 24 hours remains eligible if every other rule passes.
- Confirm addiction above the configured limit makes an employee ineligible.
- Confirm missing/stale eligibility data removes the employee from train recommendations rather than guessing.
- For a new hire under 72 hours company tenure, confirm **NEW HIRE** / ineligible behavior.
- At exactly 72 hours, confirm the new-hire hold ends when all other eligibility rules pass.
- Confirm an ineligible employee has no actionable Training Manager Train control.

## 5. Fair Rotation

- Select **Fair Rotation**.
- Confirm a never-trained eligible employee is recommended before previously trained eligible employees.
- Otherwise confirm the employee with the oldest verified last-training time is recommended first.
- Confirm ineligible, skipped and unresolved/pending employees are not recommended.
- Confirm the queue preview agrees with the primary recommended employee.

## 6. Balanced Fairness

- Select **Balanced Fairness**.
- Confirm the default fairness window is 30 days.
- Check at least one alternate preset and one custom window.
- Confirm the UI does not pretend to know eligibility before the recorded fairness tracking start.
- With **Accrue fairness debt while ineligible** disabled, confirm an observed ineligible employee does not gain fairness debt from opportunities during that period.
- If safe to exercise, enable the option and confirm subsequent observed ineligible opportunities can affect debt as configured.
- Return the setting to the desired company policy after testing.

## 7. Priority Once and Skip / Snooze

- Set **Priority Once** on an eligible employee and confirm they move ahead of normal rotation but below any eligible active paid priority.
- Refresh/reload before training and confirm Priority Once persists.
- Train that exact employee and wait for independent verification; confirm Priority Once is consumed only after verification.
- Test a next-rotation skip and confirm it clears after the next qualifying verified training progression.
- Test **until tomorrow**, a short custom timed skip, and manual-until-cleared behavior where practical.
- Confirm skipped employees are excluded from recommendation but not rewritten out of real training history.

## 8. Paid trains

Use a safe test employee/commitment and small counts where possible.

- Create a paid agreement and confirm purchased/delivered/remaining values are correct.
- Add more trains to the same employee and confirm the active agreement is amended instead of creating a second active agreement.
- Create a second paid agreement and verify FIFO ordering.
- Reorder paid agreements and confirm the director-selected order persists.
- Confirm the first eligible active paid employee becomes the primary recommendation above Priority Once and normal rotation.
- Make a paid employee ineligible, or use a safely reproducible ineligibility state, and confirm the agreement auto-pauses without losing queue position or remaining trains.
- Restore eligibility and confirm an auto-paused agreement resumes appropriately.
- Manually pause/resume an agreement and confirm the remaining balance and queue position are preserved.
- Train an employee with an active paid agreement and leave **Count toward paid commitment** enabled; confirm the balance changes only after independent training verification.
- Perform a safely authorised Bonus Train case with **Count toward paid commitment** disabled; confirm the verified train is retained in real training/fairness history but the paid balance does not decrease.
- Complete a small agreement and confirm terminal **Completed** state.
- Where safe, verify explicit Cancelled/Forfeited closure records do not fabricate delivered trains.
- Set a prolonged non-compliance threshold and confirm crossing it only surfaces removal eligibility; it must never automatically fire the employee.

## 9. Training transaction safety

- From a Job / Company tab other than **Employees**, initiate an authorised Train action for a known eligible employee. Confirm the script automatically switches Torn to the native Employees tab, waits for that exact employee row to render, and only then begins training.
- Confirm the director remains on the Employees tab after the action rather than being automatically returned to the previous company tab.
- Initiate a train while already on Employees and confirm no unnecessary tab switch occurs when the exact employee row is already rendered.
- Initiate a train and confirm explicit director confirmation occurs before Torn is asked to spend it.
- On the current `companies.php#/option=employees` route, perform one authorised training action and confirm the exact intended employee appears in Torn Company News after submission/verification.
- Confirm the exact intended Torn employee is the target.
- If company state changes while the script is switching to Employees, confirm the fresh preflight aborts/recalculates rather than spending a stale recommendation.
- If Torn fails to render the exact selected employee row after switching tabs, confirm the action fails closed before submission and does not create a training receipt or verification lock.
- After Torn accepts a training request, confirm the UI waits for independent Company News/API verification before recording the train as verified.
- If a safety condition blocks the request before submission, confirm the action reports a normal failure/block and does **not** leave the employee in `VERIFYING` / `submission_unknown` state.
- If a train genuinely enters accepted-but-unverified/submission-unknown state after the write boundary, confirm that employee remains blocked from duplicate retry across Refresh and page reload.
- If practical, open a second Torn tab and confirm a pending attempt remains visible/blocked there as well.
- Never force a duplicate live train merely to test the guard. Use naturally occurring or test-environment evidence where destructive repetition would be unsafe.

## 10. Employee-page badges and contextual actions

- On Company Employees, confirm at most one Training Manager badge is injected per employee row.
- Confirm representative states such as NEXT, PAID, PRIORITY, PAUSED, NEW HIRE or INELIGIBLE display correctly when applicable.
- Confirm no custom Training Manager Train button is placed beside Torn's Fire control.
- Open the three-dot contextual actions for both an eligible and ineligible employee.
- Confirm the action sheet has a clear **TRAINING ACTIONS** header, employee name/status context, full-width non-overlapping controls and a visually separated training-details footer.
- Confirm only relevant actions are presented for each employee and that **Dock Pay** remains visually distinct from ordinary actions.
- Generate a reminder for inactivity/addiction/new-hire and confirm it is copied/generated only; it must not send automatically.

## 11. Notifications / attention

- Confirm **Important only** is the default notification policy.
- Exercise Everything, Silent and Custom modes.
- Confirm unresolved training writes, stale/error states and paid pauses produce appropriate attention items under the selected policy.
- Confirm notification content does not reveal API keys, RFC tokens, cookies or raw authenticated payloads.

## 12. Payroll regression

Only perform this section when a real wage edit is authorised.

- Confirm Dock Pay targets the exact employee row.
- Confirm an unrelated unsaved wage edit causes the action to fail closed rather than submitting both changes.
- Confirm an already-dirty target wage field is not overwritten.
- Confirm exactly one Torn **Submit Changes** control is used.
- After an authorised dock/restore, confirm the controller waits for cache-busted API verification before marking the wage change verified.
- Restore any intentionally modified wage to the approved value after testing.

## 13. Audit and diagnostics

- Open **Gear -> Advanced -> Audit Log** and confirm recent actions are recorded with employee/action/result context.
- Filter the audit trail and test copy/export.
- Confirm clearing audit requires explicit confirmation.
- Open Diagnostics/Self-Test and verify useful health state is shown.
- Search copied diagnostics/audit output for the actual API key and current RFC token value. Neither may appear.

## 14. Data & Recovery

- Export local Training Manager data.
- Inspect the JSON and confirm the API key is absent.
- Confirm paid/fairness/override/history/settings domains expected by the current schema are represented appropriately.
- Import a valid backup and review the preview before confirming.
- Confirm an invalid/wrong-schema backup is rejected.
- Confirm the script preserves a backup of current non-secret state before applying a valid import.
- Rebuild training history and confirm the manager returns to a coherent recommendation state.

## 15. Premium UI, settings and narrow/mobile/TornPDA layout

- On desktop, confirm the manager uses the Voidsmith graphite/black/red visual treatment with crisp borders, readable silver/high-contrast text and clearly differentiated semantic green/amber/red states.
- Open Gear and confirm the settings window is legible: vertical section navigation on the left, active section visibly highlighted, one content panel on the right, no text collisions and no black-on-black Torn style leakage.
- Open each settings section and confirm labels, helper text, inputs, toggles and action buttons remain readable and correctly spaced.
- Resize the browser to a narrow/mobile-size viewport and confirm settings navigation switches to a horizontal selector and the active panel remains usable.
- Confirm roster/content reflows rather than becoming an unusable wide table.
- Verify touch-sized controls for manager/window actions are usable.
- In TornPDA, if available, verify installation/launch, Job / Company auto-open/minimized behavior, launcher visibility, settings access and a non-destructive refresh/read path.
- Treat any live training/write action in TornPDA as a separate explicit safety check rather than assuming desktop evidence transfers automatically.

## Release evidence record

Record the following after manual verification:

- userscript version:
- browser/userscript manager:
- Torn desktop result:
- TornPDA/mobile result:
- training write verified:
- paid-train accounting verified:
- payroll regression verified or not exercised:
- UI/lock/settings verification:
- unresolved defects:
- verifier/date:

Automated tests and GitHub Actions evidence belong in the release/commit history. This document records only live manual observations.