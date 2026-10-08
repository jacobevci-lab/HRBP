# Job-change impact preview and signed apply

## Scope

Employee transfer and promotion are high-impact lifecycle mutations because a position change can affect organization placement, management relationships, recruiting demand, compensation review, location-dependent obligations and critical-role coverage.

HRBP therefore uses a review-confirm flow rather than applying the selected target position directly from the first browser request.

## Flow

1. An authorized operator selects transfer/promotion, target position, effective date and reason.
2. The browser calls the tenant-scoped impact preview endpoint.
3. HRBP rechecks the current active employment, target vacancy and incumbent state.
4. HRBP calculates bounded downstream impact signals:
   - organization-unit change,
   - grade change,
   - location change,
   - direct-report count,
   - presence of the current manager relationship,
   - open recruiting requisitions on the target position,
   - critical-position state.
5. The response returns the reviewed impact snapshot plus a signed receipt that expires after ten minutes.
6. The operator explicitly confirms the reviewed change.
7. The apply endpoint rejects the mutation unless the signed receipt matches the actor, tenant, employee, target, event type, effective date and reason.
8. Apply recomputes the governed impact-state digest and rechecks target vacancy. Any intervening relationship/position/requisition change invalidates the preview.
9. Only then are employment, source/target position state, lifecycle evidence and immutable audit evidence written in one transaction.

## Signed receipt boundary

The preview receipt is HMAC-signed using the existing application session-secret boundary. It does not contain the human-entered reason in plaintext; only a SHA-256 digest is included.

The receipt binds:

- tenant and acting user,
- person and employment,
- source and target position,
- transfer vs promotion,
- effective date,
- reason digest,
- a deterministic digest of the reviewed relationship-impact state,
- issue and expiry times.

The impact digest covers source/target organization and position attributes, manager relationship, direct-report count, target criticality and open target-requisition count. This prevents a valid preview from silently surviving a material state change before final confirmation.

A receipt is valid for at most ten minutes. Editing any reviewed browser input discards the client-side preview immediately.

## Fail-closed behavior

Apply returns a controlled conflict when:

- a preview is absent, malformed, tampered with or expired,
- the preview belongs to another user, tenant, employee or target,
- event type, date or reason changed after review,
- current employment/source-position state changed,
- reviewed impact state changed,
- the target is no longer open,
- another incumbent took the target position,
- another concurrent write changed the employment.

The operator must refresh and generate a new preview rather than bypass the control.

## Downstream review warnings

The preview deliberately does not pretend to automate every downstream HR decision.

- Direct reports are not silently reassigned.
- Existing manager relationships are not silently rewritten on an organization-unit move.
- Open requisitions on the target position are not silently closed.
- Grade changes do not silently change compensation; the governed compensation process must be reviewed separately.
- Location changes require separate review of schedule, policy, benefits and jurisdiction-dependent obligations.
- Critical positions are called out for explicit review.

These are decision-support signals, not automatic policy decisions.

## Validation

`npm run job-change-impact-preview:validate` runs both the static lifecycle contract checks and signed-receipt behavioral tests. Production CI additionally runs Prisma validation, TypeScript, Next.js/OpenNext builds, Security Assurance and full Platform Regression.
