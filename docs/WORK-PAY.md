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

## Time & attendance
Schedules are effective-dated and assigned to an employment relationship. Time entries preserve source, approval state, overtime and lock state. Payroll should consume only locked or policy-approved time.

## Leave
Leave types define unit, paid/unpaid semantics, allowance and approval policy. Balances are period-specific and requests remain linked to the employment record so historical entitlement can be reconstructed.

## Compensation
Compensation changes are requests with effective dates and approval state. Approved changes should create a new `CompensationHistory` record rather than overwriting the previous salary row.

## Payroll country packs
A country pack defines the legal/calculation context for a jurisdiction and is versioned independently from the employee. Payroll periods belong to a country pack and may have multiple runs for validation or correction.

## Restricted boundary
Payroll results and compensation are restricted HR domains. Broad tenant administration is intentionally not enough to read or mutate payroll/compensation content. Dedicated compensation/payroll roles and purpose-aware audit remain part of the target design.

## Calculation direction
The current slice establishes the domain contracts, persistence and operational workspaces. The calculation engine will be added behind country-pack interfaces so tax, statutory deductions and reporting can vary by jurisdiction without forking the core people model.
