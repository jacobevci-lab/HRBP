# Connected People Data Model

## Golden record
`Person` represents the human. `Employment` represents the contractual employment relationship. `Position` represents a budgeted seat in the organization. These must never be collapsed into one object.

```text
Person
  └─ Employment
      ├─ Position ─ OrganizationUnit
      ├─ Contract
      ├─ CompensationHistory
      ├─ Payroll
      ├─ Leave / Attendance
      ├─ Goals / Reviews
      ├─ Skills / Learning
      └─ LifecycleEvents
```

Candidate data may become linked to a Person only after a controlled hire transition. Recruiting data that is no longer required follows its own retention schedule rather than becoming permanent employee history by default.

## Effective dating
Organization assignments, position assignments, manager relationships, job/grade and compensation use effective dating. HRBP One must answer both “what is true now?” and “what was true on a specific historical date?”.

## Restricted domains
EmployeeCase and special-category evidence use separate policy scopes. An ordinary manager relationship or broad HR administrator role does not grant access.

## Tenant isolation
Every domain aggregate is tenant-owned. Database policy, application authorization and cache keys enforce the tenant boundary. Cross-tenant queries are prohibited outside dedicated platform operations.
