# Recruiting → Hire → Onboarding

This vertical slice makes HRBP One the system of record before employment begins.

## Record transition

`Position → Requisition → Candidate → Application → Offer → Hire → Person + Employment → OnboardingPlan`

Candidate information does not automatically become permanent employee history. The controlled Hire transition requires an accepted Offer and creates a new Person golden record, PREBOARDING Employment, onboarding plan and lifecycle event. The source Candidate record remains governed by recruiting retention.

## Privacy and security

- Candidate records default to `RESTRICTED` classification.
- Recruiting access is separated from general employee access through explicit capabilities.
- Candidate records carry source, privacy-notice version and retention metadata.
- Hire mutations are audited.
- Identity documents belong in the restricted document vault; onboarding tasks should exchange status/attributes rather than copying document content to IT systems.
- The production identity gateway must inject trusted tenant/user/role context; browser-provided authorization headers are never trusted directly.

## Enterprise workflow direction

Requisition approval, interview scorecards, offer approval/signature, background checks where lawful, hire approval and onboarding task orchestration will be implemented as workflow templates over the shared event platform rather than as disconnected module logic.
