# Time self-service: verified create and submit

Baseline: 3aed613552be3759daf59a29ef3bdce710182314. This increment changes the employee console and its transport only; existing time APIs, approval/locking rules, schedules, tenant/relationship authorization, audit and notification transactions are unchanged.

## Interaction contract

- Saving a draft requires a 201 JSON receipt matching employment, work date, minutes, overtime and optional interval, with a valid record ID, DRAFT status and SELF_SERVICE source.
- Submission requires a 200 JSON receipt matching the selected ID and the same snapshot, with SUBMITTED status and cleared approval fields. Submitted is not approved or payroll-locked.
- The transport performs one same-origin POST, rejecting redirects. It bounds reading to 64 KiB and 15 seconds (including streamed bodies and transports that ignore cancellation). There is no automatic retry.
- The synchronous in-flight lock covers create and submit across the console. Input controls lock during submission. An employment-keyed child aborts on unmount; late responses cannot reset another employee's form or refresh its view.
- Confirmed saves and uncertain outcomes require explicit Reload and review before another mutation. A soft router refresh does not unlock stale controls. A verified create alone resets the form; uncertain or rejected results retain the entered values. Full reload discards unsaved fields and never replays the POST.
- Explicit draft validation/rate-limit rejections permit a deliberate retry after review. Conflicts, access failures and all attempted state transitions remain sealed until a fresh page view. Raw server error bodies are never displayed.
- Local form validation rejects invalid calendar values, non-integer worked/overtime minutes, incomplete or invalid intervals, and browser-normalized local times. Start/end still use the browser timezone, now disclosed. This is not a schedule-timezone or cross-day overlap engine redesign.
- The existing 60-entry loader limit remains; displayed totals are labelled as covering loaded records, not complete history. No new pagination or record editing is added.

## Verification

`node --test scripts/time-client-action.test.mjs` exercises the actual TypeScript transport, input parser and component through controlled React/network dependencies. The standard time governance prebuild validator retains its server checks and executes this suite. Platform Regression adds a mandatory unit step and appends `node scripts/time-browser-regression.mjs` after the existing gates; no earlier checks, permissions or timeouts are removed.

The browser script is restricted to fixed localhost:3100 and flagged loopback PostgreSQL hrbp_audit. It uses fresh synthetic employees/managers after existing QA setup. English desktop and Turkish mobile cover real draft creation and submission, lost/wrong receipts after actual commit, single audit/approval-notification effects, missing schedule, confirmation dismissal, editable rejection, explicit reload and notice sizing. Report: .audit/time-browser-regression.json. A written browser script is not a passing browser result; inspect the current-head CI and report before merge.

## Deliberate limits

This is not cross-tab or durable idempotency, manager time approvals, payroll locking, Action Center time decisions or whole-platform QA. The server retains its independent access, overlap, schedule and state enforcement. Unmount/reload does not undo a server write. A complete page reload is a review barrier, not proof every old record is present in the bounded list. No production data, secrets, dependencies, migrations or provider deployment settings change. The separate Cloudflare deployment issue is not solved by this patch.
