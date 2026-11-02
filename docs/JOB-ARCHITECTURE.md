# Job Architecture Foundation

HRBP One treats job architecture as governed workforce master data rather than free-text labels on a position.

## Model

```text
Job Family
   └─ Job Profile
       ├─ Job Level
       ├─ Skill Requirements
       └─ Position
```

A **Job Family** groups related work. A **Job Level** expresses tenant-owned career/complexity ordering. A **Job Profile** is effective-dated and binds a family, a level and optional governed skill requirements. Positions may reference one active/current profile.

Existing `Position.jobFamily` and `Position.grade` fields are retained during migration. When a new position is created with `jobProfileId`, HRBP snapshots the selected profile's family name and level code into those legacy fields so existing reads remain compatible while consumers migrate to the structured relation.

## Governance

- Read and write are separate `job-architecture:read` / `job-architecture:write` capabilities.
- Every API query is tenant-scoped.
- Mutations require same-origin protection and append audit evidence.
- Profiles cannot reference inactive or cross-tenant families, levels or skills.
- Profile code/date ranges cannot overlap.
- New profiles may be DRAFT or ACTIVE; RETIRED is reserved for a later governed lifecycle transition.
- Position assignment accepts only an ACTIVE profile effective at the mutation time.
- Skill requirements are bounded to 50 unique skills and use the existing reviewed proficiency taxonomy.

## Migration boundary

This increment is additive. No existing position is automatically remapped and no historical free-text family/grade value is rewritten. A later Migration Center workflow will propose mappings, validate them, preview impact and require an explicit operator action before historical positions receive structured profile references.

## Next slices

1. Job Architecture administration workspace.
2. Profile retirement/version lifecycle.
3. Salary bands and compensation architecture.
4. Migration Center mapping from legacy family/grade values.
5. Workforce planning and recruiting references to Job Profile.
6. Skills-gap analysis from Job Profile requirements versus governed employee skill evidence.
