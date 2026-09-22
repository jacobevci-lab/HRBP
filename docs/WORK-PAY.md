# Work & Pay Architecture

HRBP One treats time, leave, compensation and payroll as one governed chain rather than independent calculators.

```text
Employment
  ├─ Work Schedule → Time Entry → Locked Time
  ├─ Leave Policy → Balance → Leave Request
  ├─ Compensation History ← Approved Compensation Change
  └─ Payroll Country Pack → Payroll Period → Payroll Run
                                      └─ Payroll Result → Line Items
```

## Relationship-aware access
Workforce authorization is derived from the authenticated employment relationship instead of a broad `role = manager` filter. The common employment scope resolves these boundaries before People, Time, Leave, Compensation and Performance data is loaded:

- `EMPLOYEE`: self only.
- `MANAGER`: self plus direct reports linked by `managerEmploymentId`.
- `HRBP`: self plus explicit, effective-dated `EmploymentAccessGrant` population records.
- employee-relations / legal / privacy case roles: self plus active employment relationships for case subjects where the user is owner or an assigned case participant.
- operational tenant-wide roles: HR Operations, Time Admin, Talent Admin, Compensation Admin, Payroll Admin and Tenant Admin. Domain RBAC is still evaluated first, so tenant-wide relationship scope never grants a capability the role does not already have.

HRBP population grants are managed from Settings and every grant/revoke mutation is tenant-scoped, origin-checked and audit logged.

## Time & attendance
Schedules are effective-dated and assigned to an employment relationship. Time entries preserve source, approval state, overtime and lock state. Payroll should consume only locked or policy-approved time.

## Leave
Leave types define unit, paid/unpaid semantics, allowance and approval policy. Balances are period-specific and requests remain linked to the employment record so historical entitlement can be reconstructed.

## Compensation
Compensation changes are requests with effective dates and approval state. Approved changes create a new `CompensationHistory` record rather than overwriting the previous salary row. Read, request, approval and apply operations are relationship-scoped in addition to the dedicated compensation capability boundary. Requesters cannot approve or apply their own changes.

## Payroll country packs
A country pack defines the legal/calculation context for a jurisdiction and is versioned independently from the employee. Payroll periods belong to a country pack and may have multiple runs for validation or correction.

## Restricted boundary
Payroll results and compensation are restricted HR domains. Broad tenant administration is intentionally not enough to read or mutate payroll/compensation content. Dedicated compensation/payroll roles, relationship scope and purpose-aware audit remain part of the control design.

## Calculation direction
The current slice establishes the domain contracts, persistence, relationship-aware authorization and operational workspaces. The calculation engine will be added behind country-pack interfaces so tax, statutory deductions and reporting can vary by jurisdiction without forking the core people model.
