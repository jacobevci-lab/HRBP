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
- Future-dated profiles are created as DRAFT. ACTIVE creation is allowed only when the profile is already inside its effective date window.
- Lifecycle is explicit and terminal in this slice: DRAFT → ACTIVE → RETIRED. Activation revalidates active family, level and skill dependencies. Retirement ends the profile immediately; existing Position references remain historical and new assignments are blocked.
- Position assignment accepts only an ACTIVE profile effective at the mutation time.
- Skill requirements are bounded to 50 unique skills and use the existing reviewed proficiency taxonomy.

## Migration boundary

This increment is additive. No existing position is automatically remapped and no historical free-text family/grade value is rewritten. A later Migration Center workflow will propose mappings, validate them, preview impact and require an explicit operator action before historical positions receive structured profile references.

## Administration experience

Authenticated users with `job-architecture:read` can open **Positions → Job Architecture** without adding another top-level navigation item. The workspace exposes current families, career levels, profiles, mapped positions and skill requirements. Users with `job-architecture:write` can create governed family, level and profile records, including bounded skill requirements.

The Position creation page resolves organization units and active/effective Job Profiles from the signed tenant context. It no longer reads tenant options through the public workspace fallback. Selecting a structured profile disables manual family/grade entry and the server remains the authority for the canonical snapshot values.

## Next slices

1. Job Profile version creation / supersession for future structural changes.
2. Salary bands and compensation architecture.
3. Migration Center mapping from legacy family/grade values.
4. Workforce planning and recruiting references to Job Profile.
5. Skills-gap analysis from Job Profile requirements versus governed employee skill evidence.
