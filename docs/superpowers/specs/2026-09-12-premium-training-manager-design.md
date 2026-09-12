# Torn Company Training Manager Premium Training Design

## Goal

Evolve Torn Company Training Manager into a premium Voidsmith Industries training-focused director tool without expanding it into a general company ERP. The director should see only what matters now: available trains, the recommended employee, a short queue preview, essential employee status, and one obvious training action. Advanced capability remains available behind the Gear menu or contextual row actions.

## Product boundary

This release is training-only. It may include eligibility, training recommendation, fairness, paid-train commitments, temporary training overrides, training-related payroll consequences already present in the product, training history, training verification, training notifications, training diagnostics, and local recovery.

Explicit non-goals:

- no company finance dashboard;
- no stock or inventory management;
- no advertising analytics;
- no hiring optimiser;
- no cloud account or hosted backend;
- no remote telemetry;
- no Google Sheets dependency;
- no automatic unattended training;
- no automatic firing;
- no automatic Torn messaging;
- no AI company adviser;
- no generic company-ERP expansion.

## Doctrine

Security first, performance second, ease of use third.

The existing fail-closed training architecture remains authoritative: explicit director confirmation, fresh preflight, exact employee targeting, accepted-versus-verified state separation, persistent unresolved-receipt locking, cross-tab duplicate protection, and no historical bookkeeping from an unverified POST response.

All new training modes consume the same verified training truth. No subsystem may invent a separate train history.

## Core recommendation precedence

The recommendation engine must apply these gates in order:

1. Safety gate: stale, unknown, ambiguous, or unresolved state blocks a training write.
2. Eligibility gate: employee must be training-eligible.
3. Paid priority: first eligible active paid commitment, ordered FIFO by creation time unless the director has explicitly reordered paid commitments.
4. Priority Once: one eligible normal employee may be manually placed above the normal rotation for exactly one verified train.
5. Normal rotation: Fair Rotation or Balanced Fairness.
6. Manual train: the director may still deliberately train any eligible employee from that employee's contextual action.

Skip/Snooze removes an employee from recommendation calculations only. It does not change eligibility, history, fairness history, or paid balances.

## Eligibility

Training eligibility requires all of the following:

- at least 72 hours in the company;
- inactivity no greater than the existing fixed 24-hour cutoff;
- addiction no greater than the director's configured threshold;
- verified source data for required fields.

If company join time cannot be verified, training eligibility fails closed.

New hires show remaining hold time and do not enter paid recommendation, Priority Once recommendation, normal rotation, or fairness-debt accrual until the 72-hour hold has completed.

## Fair Rotation

Fair Rotation remains the default and preserves the current simple behavior:

- eligible never-trained employees first when `prioritizeNeverTrained` is enabled;
- then the eligible employee with the oldest verified last-training timestamp;
- deterministic tie breakers by join time and Torn ID.

Paid priority and Priority Once sit above Fair Rotation.

## Balanced Fairness

Balanced Fairness is optional and lives behind Gear -> Fairness.

Default configuration:

- rolling window: 30 days;
- presets: 7, 14, 30, 60, 90 days plus Custom;
- ineligible time does not accrue fairness debt by default;
- the director may opt in to accruing fairness debt while ineligible.

Balanced Fairness uses eligibility-adjusted expected share internally. On each verified company-train opportunity, employees eligible for debt accrual receive an equal expected share; the employee who actually receives the verified train receives one actual train credit. The displayed metric is `expected share - actual verified trains` over the configured rolling window.

The normal UI must not expose the calculation formula. It shows simple labels such as `Behind by 1.8`, `On balance`, or `Ahead by 1.1`. Detailed math may appear only in an optional detail panel.

Historical eligibility must never be invented. Historical Company News may seed verified train history for display, but fairness debt begins only from trustworthy observed eligibility. The UI must expose the fairness tracking start date when details are opened.

## Paid train commitments

Paid train commitments are first-class training state, not accounting state.

Each commitment stores:

- employee Torn ID and display name snapshot;
- trains purchased;
- verified trains delivered;
- trains remaining;
- agreement start timestamp;
- optional price per train;
- optional total paid;
- optional note/reference;
- lifecycle status: active, auto-paused, manually-paused, completed, cancelled, or forfeited;
- optional pause reason;
- completion/cancellation/forfeiture timestamp when applicable;
- deterministic paid-queue order.

Only one active/non-terminal paid commitment may exist per employee. Additional purchases amend the active commitment by increasing the purchased/remaining count and recording an audit event.

Paid queue ordering is FIFO by commitment creation time by default. Directors may manually reorder paid commitments. Paid employees remain above the normal queue.

Paid priority controls the recommendation, not the director's freedom. Any other eligible employee may still be manually trained.

A train reduces a paid balance only after the existing independent training verification proves the train happened. Requested, accepted, awaiting-verification, unknown, rejected, or failed states do not change the paid balance.

If an employee with an active paid commitment is manually trained, the confirmation defaults to `Count toward paid agreement = true`. The director may untick it to classify that verified train as a Bonus Train. Bonus trains count in real training history and normal fairness but do not reduce the paid balance.

Paid trains count toward normal fairness history. Completing a paid commitment returns the employee to normal rotation according to actual training history.

## Paid ineligibility and removal policy

Paid status never overrides eligibility.

When a paid employee becomes ineligible:

- the commitment automatically pauses;
- remaining trains are preserved;
- the employee is skipped in the active paid queue;
- the next eligible paid commitment becomes recommended;
- if no paid commitment is eligible, recommendation falls through to Priority Once/normal rotation;
- eligibility recovery automatically reactivates the commitment in its existing queue position unless it was manually paused.

The director configures a prolonged-ineligibility threshold. Suggested presets are 2, 3, and 7 days plus Custom. The application does not impose a universal value.

Crossing the configured threshold marks the employee `Removal Eligible`. The application never fires an employee automatically.

If the director closes a paid commitment because the employee was dismissed for prolonged non-compliance, the default closing outcome is Forfeited, but explicit director confirmation is required. If a paid employee leaves voluntarily, the application surfaces a review action offering Forfeit, Keep obligation, or Close/refunded externally. The application never moves Torn money or claims a refund occurred automatically.

Rehiring an employee does not silently reactivate a terminal historical commitment.

## Priority Once

A director may mark one eligible normal employee as `Priority Once`.

- It sits below active eligible paid commitments and above normal rotation.
- It is consumed only by one verified train to that employee.
- If the employee becomes ineligible, the priority is suspended rather than bypassing eligibility.
- It resumes if eligibility returns, unless the director clears it.

## Skip / Snooze

The employee contextual menu offers:

- Next rotation;
- Until tomorrow;
- Custom duration;
- Until manually restored.

Skip/Snooze affects recommendation only. It does not mutate eligibility, verified training history, paid balance, or fairness accounting. Expiry restores the employee to the correct calculated queue position.

## Main UI

The default floating manager must remain intentionally simple.

Header:

- restrained Voidsmith Industries identity;
- health/status dot;
- compact Attention count when relevant;
- minimize;
- maximize/restore;
- Gear.

Primary summary:

- available trains;
- recommended employee;
- eligible count;
- recommendation reason/status.

Primary action:

- one obvious training button for the recommended employee;
- label adapts to Paid Priority, Director Priority, Fair Rotation, or Balanced Fairness;
- optional `Why?` explanation reveals one concise sentence.

Queue preview:

- show the next four recommended employees by default;
- each row shows only name plus concise queue reason such as `PAID · 8 left`, `Priority once`, `Behind 1.8`, or `On balance`;
- `View all` reveals the full roster.

Employee roster default columns:

- employee;
- training status;
- last train;
- action/context menu.

Additional activity, addiction, company tenure, total trains, fairness detail, paid details, and existing pay state appear on row expansion or contextual actions instead of permanent columns.

Search supports employee name and Torn ID. Default filter is All. Optional filters: Eligible, Attention, Paid, Skipped, Ineligible. Sort options include recommendation order, name, last train, activity, addiction, fairness, and paid remaining.

## Contextual employee actions

Eligible normal employee:

- Train;
- Priority Once;
- Skip / Snooze;
- Create Paid Train Agreement;
- View Training Details.

Paid employee:

- Train;
- Train as Bonus / use confirmation checkbox;
- View Paid Agreement;
- Skip / Snooze;
- View Training Details.

Ineligible employee:

- View reason;
- Copy Reminder;
- Dock Pay when existing payroll policy makes it relevant;
- View Training Details.

Restore Pay remains available contextually when a verified dock can be restored.

## Attention and notifications

Default notification mode is `Important only`.

Modes:

- Important only;
- Everything;
- Silent;
- Custom.

Custom expands granular categories. The main surface shows only a compact Attention count. Opening it reveals grouped items.

Critical examples:

- stale/API state;
- unknown train outcome;
- prolonged verification;
- unsafe write blocked.

Action examples:

- paid commitment paused;
- removal threshold reached;
- pay restoration available;
- departed paid employee requires contract review.

Informational examples:

- paid agreement nearly complete;
- employee became eligible again;
- skip expired.

Silent mode may hide optional notifications but may not suppress inline safety reasons for blocked actions.

## Reminder helpers

For inactivity or addiction ineligibility, provide a Copy Reminder action with concise editable text and an Open Profile action. Never send messages automatically.

## Job / Company availability and window behavior

The Training Manager launcher must be available throughout Torn's Job / Company area, not only the Employees tab.

The full manager is a floating window:

- draggable;
- fully resizable with sensible minimum dimensions;
- maximizable to the usable viewport;
- restore returns to the previous normal geometry;
- minimize hides the entire floating manager;
- minimize leaves only a small Training Manager launcher icon in Torn's sidebar/status area, similar to ReviveRelay;
- clicking the icon restores the manager;
- no residual header or minimized shell remains on screen;
- saved geometry, maximized state, and minimized state survive reloads and Torn SPA navigation;
- the launcher reattaches after Torn redraws the sidebar/status area.

Outside Job / Company, preserve the existing lightweight global behavior only if enabled by settings; the premium floating manager itself is intended for Job / Company routes.

## Torn native employee indicators

On relevant employee rows, add at most one prominent training badge plus minimal status detail. Candidate badges: NEXT, PAID, PRIORITY, PAUSED, INELIGIBLE. Do not clutter the native page or place custom Train controls adjacent to Torn's destructive Fire control.

## Mobile / TornPDA presentation

Desktop may use compact rows. Narrow/mobile/PDA layouts must use touch-friendly employee cards with primary actions at least approximately 44px tall and must not place frequent custom actions beside destructive Torn controls.

The same training logic and safety state apply on desktop and mobile.

## Gear / Settings information architecture

Settings categories:

- General;
- Training Rules;
- Paid Trains;
- Fairness;
- Notifications;
- Appearance;
- Data & Recovery;
- Advanced.

Only one section should be expanded at a time. Advanced options remain hidden until requested.

General includes API key and refresh interval.

Training Rules includes fixed 24h inactivity policy display, fixed 72h new-hire hold display, addiction threshold, prolonged-ineligibility threshold, and skip defaults.

Paid Trains manages commitments, paid queue ordering, and completed history.

Fairness manages Fair Rotation/Balanced Fairness, rolling window, and ineligible-debt option.

Notifications manages Important/Everything/Silent/Custom.

Appearance stays intentionally small: compact density, reduced animation, native training badges on/off.

Data & Recovery provides export, import, reset local data, and rebuild training history.

Advanced contains diagnostics, audit log, and compatibility information.

## Export / Import

Export may include settings, training-history/cache state, paid commitments, paid queue ordering, fairness ledger, skips/priorities, manager UI state, and optionally audit history.

The Torn API key is excluded by default and must never be silently exported.

Import requires schema/version validation, a preview of what will change, explicit confirmation, and an automatic local backup of current non-secret state before replacement.

## Audit log

Retain the existing sanitized local audit architecture and add training-domain events for:

- paid_contract/created;
- paid_contract/amended;
- paid_contract/paused;
- paid_contract/resumed;
- paid_contract/completed;
- paid_contract/forfeited;
- priority/added;
- priority/consumed;
- priority/cleared;
- skip/created;
- skip/expired;
- skip/cleared;
- fairness/mode_changed;
- train/verified_paid;
- train/verified_bonus.

Audit/diagnostics must never store or expose Torn API keys, RFC token values, cookies/session data, authorization headers, or raw authenticated response bodies.

## Storage and state boundaries

Keep distinct persisted domains for:

- settings;
- verified training history;
- paid commitments;
- fairness ledger/observations;
- priority/skip overrides;
- payroll state;
- train receipts;
- audit;
- manager UI geometry;
- cache.

Each domain requires schema validation and safe fallback. Sensitive credentials remain isolated from exportable non-secret state.

## Performance

- Do not add remote telemetry or remote dependencies.
- Do not perform constant full-page DOM scans.
- Observe only required Torn areas and debounce SPA mutation handling.
- Recompute derived recommendation state when source state changes, not continuously.
- Avoid unnecessary API requests and external resources.
- Keep system-font styling and local assets only.
- Respect `prefers-reduced-motion`.

## Premium visual direction

Use a restrained Voidsmith visual language: graphite/near-black layered surfaces, forged-silver text, subtle ember-red brand accents, semantic green/amber/red states, consistent spacing, crisp hierarchy, restrained 120-180ms transitions, polished loading/disabled/verified states, and no dependency on external fonts.

Brand red must not replace semantic positive/safe action styling. The main Train action remains visually positive and unambiguous.

## Release and documentation

This is a substantial minor release and should target version `1.2.0` unless implementation evidence forces a different release decision.

Update README, CHANGELOG, and the missing live manual-verification checklist. The checklist must cover desktop, TornPDA/mobile, Job/Company route availability, minimize/restore/maximize persistence, paid verification accounting, fairness modes, skip/priority behavior, payroll regressions, and stale/unknown fail-closed behavior.

## Acceptance criteria

1. Existing training reliability and duplicate-prevention tests remain green.
2. New hires under 72h cannot be recommended or trained through the manager.
3. Paid commitments outrank normal recommendations while preserving manual director freedom.
4. Paid balances change only after verified training and correctly distinguish paid versus bonus.
5. Paid ineligibility auto-pauses and resumes without changing balance or queue position.
6. Fair Rotation remains the default and preserves current deterministic behavior after the new-hire gate.
7. Balanced Fairness provides rolling eligibility-adjusted debt without inventing historical eligibility.
8. Priority Once is consumed only by a verified train; Skip/Snooze affects recommendation only.
9. The default manager UI shows only essential training information; advanced controls remain behind Gear/contextual actions.
10. The manager is available throughout Job / Company, fully draggable/resizable/maximizable, and fully disappears into a compact sidebar/status icon when minimized.
11. Saved window geometry and minimized/maximized state survive reloads and SPA navigation.
12. Mobile layout uses touch-friendly cards and avoids destructive-control proximity.
13. Notification defaults show important items only and remain configurable.
14. Export/import preserves non-secret training state safely and excludes API key by default.
15. Audit/diagnostics stay sanitized.
16. `npm run check` passes from a clean checkout and the built userscript version/metadata match package `1.2.0`.
