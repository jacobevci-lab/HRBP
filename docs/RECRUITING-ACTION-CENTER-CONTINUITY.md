# Recruiting approval continuity

Recruiting requisition and offer approvals now participate in the shared Lifecycle Action Center without creating a second decision engine.

## Projection rules

A Recruiting approval appears in the central queue only when all of the following are true:

- the signed actor has both `recruiting:write` and `recruiting:approve`;
- the Requisition or Offer is currently in `APPROVAL`;
- immutable creation audit provenance exists; and
- the creator is not the signed actor.

Missing creator provenance fails closed. The Action Center never assumes that an approval is independent when it cannot prove who prepared the record.

## Human-owned decisions

The central queue is deep-link only:

- Requisition: `/module/recruiting?requisition=<id>`
- Offer: `/module/recruiting?offer=<id>`

Approve, return, cancel and withdraw operations remain in the existing Recruiting status routes. Those routes continue to enforce transition rules, `recruiting:approve`, serializable transactions, audit evidence, position/application prerequisites and the existing self-approval block.

No approval outcome is generated automatically by the Action Center.

## Notification continuity

After a successful independent Requisition or Offer decision, the Recruiting console performs best-effort acknowledgement of the matching `Requisition` or `Offer` notification and refreshes the shared lifecycle/notification surfaces.

The notification acknowledgement is deliberately secondary to the business transaction. A notification cleanup failure never rolls back or changes an approval decision that already committed successfully.

## Data minimization

The Requisition projection contains only operational context needed to recognize the approval, such as title, position and opening count.

The Offer projection contains candidate display name, requisition title, start date and expiry when present. Salary, currency, bank/payment information and other compensation details are deliberately not loaded by the central Action Center.

Offer expiry can drive due-date urgency. Requisitions do not receive an invented SLA when the domain record has no explicit approval deadline.

## Exact deep links

The existing Recruiting operations console resolves `requisition` and `offer` query parameters against its governed active/approval workspace. A stale, terminal or unavailable record is not substituted by a broader lookup; the workspace reports that the linked record is no longer present in the current governed surface.

## Aggregate continuity

Dashboard and Analytics consume the same top-level Recruiting continuity wrapper. Only the aggregate `recruiting` count crosses those boundaries; candidate identity, offer details and record identifiers remain in the owning Recruiting workspace.

## Validation

`npm run recruiting-action-center:validate` verifies capability gating, approval-state filtering, audit provenance, creator exclusion, salary-data exclusion, deep-link-only behavior, notification acknowledgement ordering, existing domain four-eyes controls and aggregate-only Dashboard/Analytics propagation.
