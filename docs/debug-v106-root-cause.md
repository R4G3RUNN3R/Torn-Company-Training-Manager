# v1.0.6 root-cause note

Observed live symptom after v1.0.5: the full Company Training Manager falls back to the compact global badge on the Torn company Employees page, and Train produces no visible result.

Root cause found by comparing the current implementation with a known working Torn company-management implementation from the user's existing code:

1. `isCompanyEmployeesPage()` only recognizes the Employees view via URL/hash or legacy `a[href*="step=trainemp2"]` / kick anchors. Torn can keep the Employees tab active through tab state while rendering employee actions as button/wrapper controls.
2. `CompanyPageActions` resolves training targets only from legacy train anchors. Torn's loaded Train control can be `.train .train-action.btn-wrap button.torn-btn`, `.train button.torn-btn`, or the `.train-action` wrapper inside an employee row keyed by `data-user`.
3. A failed/unsafe train action currently returns a status object that the UI discards, leaving the user with no visible error.

Fix scope: model Torn's real Employees-tab state and button-based Train controls, while retaining exact employee-ID resolution and fail-closed behavior; surface failed/unverified action results to the user.
