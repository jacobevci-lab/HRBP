# Policy assignment/exception forms — PR integration

This change integrates the previously local form package into PR #223, based on f7cdd5efa30c639cb5aa8c5e41457ffe070504f5. The supported source-upload action accepted the reviewed files during this continuation. Full application and actual browser/PostgreSQL checks must validate the new commit; earlier main/PR results are not evidence for this code. No production deployment or main merge is asserted.

The sections below preserve the historical local-review evidence and its limitations. Statements about unexecuted scenarios refer to those earlier local review sessions, not a substitute for the new commit's eventual CI results. Check the PR timeline for exact-head evidence. The separate Cloudflare provider problem remains tracked in #220.

## Existing form work retained
Named EN/TR dialogs, bounded employee choices, literal user-entered text, explicit confirmations, one in-flight write, identity/status receipt checks, and an unknown-result guard across mounted dialog close/reopen remain. Reads are explicit and abortable; stale responses cannot replace current options. The assignment-options success response retains private/no-store and Vary: Cookie. Server authorization, scope, row locking, four-eyes decisions and audit transactions are unchanged.

## This review: confirm the submitted fields, not just IDs and counts
A reply for the right policy and tenant can still describe a different batch. Assignment responses now include `request: { employmentIds, dueAt }` built by the owning route from the validated, sorted IDs and normalized date. The client requires exact set/date equality, balanced integer counts and matching policy/tenant. The field describes the submitted request; it does not claim existing skipped assignments changed their deadline. Existing statuses, acknowledgements, waivers and deadlines remain intact.

Exception request receipts must also match the submitted reason, nullable compensating control and normalized expiry, and include a canonical creation timestamp. Same-policy/same-principal replies with other text or expiry no longer produce a success signal. No full request text is added to the assignment response, logs or global events. Exception routes already return their persisted fields; no exception schema change is introduced.

Malformed or mismatched success replies retain the draft, keep the mounted write guard and instruct explicit read/reload recovery. Closing/reopening or changing language does not release that guard. Correct replies still work, including nonempty UTC deadlines and controls. These checks detect mismatched receipts, not malicious control of the server, a cryptographic proof, or cross-session exactly-once execution. Identical requests on another device cannot be distinguished merely from identical returned fields.

## Contracts and rollout
Install the form and matching assignment API changes together. Old assignment responses without the validated request object intentionally remain unconfirmed in the new UI. Old existing assignments are never rewritten by a retry. New exception dates use UTC day end (23:59:59.000Z), as documented in the previous local package; this review adds no timezone policy. Search covers the first 500 authorized choices only. Approving an exception does not waive or acknowledge the policy automatically.

## Verification actually executed
Original package rerun: 146/146 unit/component/endpoint tests passed. After adding 18 receipt-binding tests, the unmodified implementation passed 102/118 and failed 16/118. Additional positive and endpoint normalization assertions were then added.

Final source: 170/170 passed (120 form/contract tests plus 50 endpoint tests); zero skipped or cancelled. These are executable test doubles, not React DOM/SQL acceptance. The package installer passed 6/6 separate tests. The contract helper alone passed strict TypeScript with TypeScript 5.8.3 / Node 22.16.0. Both browser/regression scripts passed Node syntax checking.

The existing 17 actual Chromium/PostgreSQL form scenarios were expanded by five committed-response mismatch cases (22 planned scenarios). An attempt to launch the script failed before any scenario because @prisma/client was unavailable. A complete repository/dependency install, full app typecheck/build, real browser execution, screenshots and CI are not established. Never count the 22 planned scenarios as passed or skipped tests. The prior SQL regression script's complete response assertions were updated to the new contract but were not rerun against PostgreSQL here.

## Remaining acceptance
Reviewed source application on the authorized development branch; full application typecheck/build and existing gates; all actual API/browser suites; EN/TR mobile/dialog/keyboard visual acceptance. Provider deployment issue #220, other modules and customer UAT remain separate. Do not use production records or remove the disposable-loopback checks to obtain test output.


## Offline native DOM review — 2026-10-15

The forms now use `usePolicyDialog` while their existing native dialog is active.
It locks page-root scrolling across multiple participating owners, contains Tab /
Shift+Tab at the current visible control boundaries and releases listeners/styles
on close or unmount. Escape and native focus restoration remain form-owned.
Only overflow declarations still owned by this lock are restored; unrelated or
subsequently changed styles are preserved. An independently introduced identical
inline value cannot be distinguished as a new owner; other modal libraries need
shared coordination when integrating. Overscroll is contained by the dialog/list.

Actual offline Chromium 144.0.7559.96 tests used React 18.2.0 and the installed
Notebook ReactDOM 18.2.0-next-9e3b772b8-20220608 build. These are real DOM/hooks but
NOT the application's locked React19 / Next.js runtime. Session, locale, router,
icons, theme tokens and transport were explicit fixtures; no network requests or
PostgreSQL operations occurred. All screenshots are labelled as isolated tests.

The same 20 checks with 40 Tab + 40 Shift+Tab transitions per focus case produced
16 pass / 4 fail against the incoming local package and 20 pass / 0 fail after
the fix. Both forms allowed the background page to move 650px before the change;
both allowed focus to leave at a Tab boundary. Source snapshots are in the reports.
The new ownership tests pass 8/8, adding to retained 170 tests for 178/178.

The real production-app/SQL form script still has 22 scenarios and was NOT run.
Its existing narrow-dialog cases now also require scroll locking and extended
Tab / Shift+Tab containment; assertions were not removed. Full build, project
React19 behavior, browser navigation, actual provider/session handling and DB
persistence remain acceptance gates. No GitHub source commit or deployment.


## Local review 4 — record outcome retention (not committed)

`usePolicyAction` now retains at most 32 attempted record keys and their bounded outcome labels for the mounted component. An A result arriving while B is visible is saved under A without refreshing B or emitting B-facing success events. Returning to A after working on B, or after a temporary session-context loss, cannot silently re-enable A's uncertain/saved action.

The first 32 confirmed dispatchable attempts occupy history entries. At capacity, new keys require an explicit reload instead of evicting the oldest guard. Cancelled confirmations do not consume capacity. Confirmation failure or a changed record before dispatch makes no request. This memory contains no request bodies, exception narratives, employee lists or credentials.

This remains local, mounted-instance protection, not durable idempotency. Unmount, browser reload and other tabs/devices are not coordinated by this map. A legitimate repeated lifecycle with an identical record key can require an explicit reload; a new server generation is not inferred from a repeated status label. Draft fields for different records are not retained by the outcome map. Server authorization, locking and evidence remain authoritative.

Executed in this review: 234 unit/component/endpoint tests (test doubles), 26 offline Chromium DOM checks using local React18.2 and fixture transport; these are separate counts and not React19/Next.js/PostgreSQL acceptance. The 22 existing real application scenarios remain unexecuted. The new read-only package-root `verify_acceptance.mjs` reports missing dependencies/configuration as BLOCKED with zero tests started; it never treats a prerequisite pass as test acceptance.
