# Leave amount unit precondition

The current employee self-service form submits `expectedUnit: DAYS|HOURS` from
the selected, displayed type. The create endpoint compares it with the active
same-tenant leave type in the same Serializable transaction used for overlap,
balance, create, audit and notification intent. A different unit returns 409
`LEAVE_UNIT_CHANGED` before creating a request, consuming balance or writing a
success audit. Invalid supplied values return 400 instead of defaulting to DAYS.

An accepted bound request returns `validatedUnit`, from the checked type, and
its ordinary creation audit records the enum in purpose. The client requires
that field to match before showing success or resetting the form. A missing or
substituted unit, including a response from an older API, stays unknown and
blocked; it is not evidence that the request failed to save. A specific unit
conflict retains the draft and provides localized review/reload guidance. A full
reload discards unsubmitted fields; there is no implicit day/hour conversion.

## Compatibility and boundaries

The field is additive and optional for existing API consumers. Unbound legacy
requests retain their previous semantics and receive neither `validatedUnit` nor
a unit-verification audit purpose. Deploy the new server before or with the UI.
An old server may save a new request but its missing proof will not be labelled
confirmed by the new UI. This is not a universal precondition for every legacy
client and not a general configuration/version fingerprint.

The check concerns the transactional type at creation, not immutable historical
units or a prohibition on later administrative type changes. No allowance,
calendar, approval-rule, balance conversion, schema or permission is changed.
An identical unit does not prove that other type settings were unchanged.
Historical records and audits are not backfilled. No durable command idempotency
or automatic retry is introduced. Existing complete rollback and permission
checks remain mandatory.

## Evidence

`leave-unit-binding.test.mjs` executes real parser, handler and receipt helper
code with controlled dependencies; existing `leave-client-action.test.mjs`
component regressions are retained unchanged. `leave-unit-binding-browser.mjs` adds
eight signed-session/real PostgreSQL/Chromium cases to the sixteen prior unit
cases: stale configuration conflicts, reviewed new-unit saves, post-commit wrong
unit replies and legacy omission compatibility in EN and TR. These acceptance
cases must be checked on the final exact commit, not inferred from local tests.
