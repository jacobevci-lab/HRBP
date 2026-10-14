# HRBP One — Customer Pilot Acceptance (UAT)

Status: **proposed acceptance contract; NOT evidence of completed customer testing**.
Applies to the customer-controlled, single-host on-prem installation profile. The actual scope, jurisdiction, integrations and signatories must be agreed before a pilot starts.

## Pilot positioning and exclusions

Pilot the connected **Core HR + Employee Lifecycle + Talent & Growth + Workflows + Governance** processes first. Leave statutory payroll, unvalidated third-party connections, external AI responses, multi-host high availability and legally binding e-signature capabilities out of the accepted scope until separate provider/jurisdiction evidence exists. A UI/API or green CI alone does not establish customer readiness.

- System of record: Person, Employment, Position and effective-dated organization relationships remain distinct.
- Human decisions: Talent, calibrated performance, successor readiness, compensation, disciplinary outcomes and terminations require authorized human actions. Learning completion must not auto-promote a worker.
- Installation: customer-provided TLS reverse proxy, identity provider, key management, monitoring, backup destination and operational access are explicit dependencies; the bundled Compose profile is not HA.
- Non-production: begin with fabricated employee/candidate documents and isolated test identities. Do not upload real special-category or payroll data before access/privacy gates pass.

## Release evidence and operating rules

Record the **exact 40-character approved main commit** in the UAT record. Do not substitute a branch name, unverified local code or a successful PR workflow for evidence of the deployed revision.

Required before testing live workflows:

1. CI, Platform Regression, Security Assurance and Release Verification are all green on the same approved main revision.
2. Verify the source/SBOM release evidence and checksums; if a customer image is distributed, separately verify its digest/provenance. The source attestation alone does not sign a built OCI image.
3. Install preflight and postflight pass on the actual isolated pilot host, with matching revision and migration history. Review docs/ONPREM-DEPLOYMENT.md.
4. Customer OIDC login, required MFA/trusted-device posture, reverse proxy TLS and secret handling are checked in the customer environment. Production example local login is disabled by default.
5. Object vault and malware scanner are healthy, unreadable pending/quarantined documents remain blocked, scheduled maintenance and notification delivery health are visible to operators.
6. A test backup and isolated restore have been rehearsed; production restore, destructive database reset or migration replay are never run merely to satisfy UAT.
7. Pilot-specific RPO/RTO, expected record volume, support window, retention, monitoring and disabled integration list are documented and accepted.

Useful release verification commands (run only in the environments permitted by their documentation):

    npm run onprem:validate
    npm run onprem:preflight
    npm run onprem:pilot:postflight -- --expected-revision <APPROVED_40_CHARACTER_COMMIT_SHA>
    npm run db:migrate:status
    npm run onprem:recovery:rehearsal

The pilot postflight command is read-only on the approved running application and must fail closed if the SHA, release protocol or fresh nonce does not match. Its `runtime.approvedRevisionVerified=true` proves only local runtime identity, not end-user UAT. Plain `onprem:postflight` is not sufficient for signed pilot acceptance.

The last command is an isolated, destructive disposable-project rehearsal. Production upgrades require an approved maintenance window using the guarded procedure; do not run an upgrade/restore automatically as part of a read-only assessment.

## UAT identities and access fixtures

Provide fabricated test identities for Tenant Admin, HR Operations, HRBP (an explicitly granted employment population), Manager (own/direct reports), Employee (self), Talent Admin, Compensation Admin, Payroll Admin, Privacy Officer, and a specifically assigned Employee Relations case participant. Include at least **two distinct test tenants** and two managers with non-overlapping employee populations for negative access tests.

Record the identity provider, MFA result, manager/employment relationship, assigned capabilities and tenant for each fixture. Never place actual credentials, tokens, bearer values, addresses or employee names into tickets or exported UAT attachments.

## Customer workflow matrix

Each case must have a tested role, tenant, input fixture, expected state, observed state, timestamp, source revision, evidence reference and an owner-signed PASS/FAIL/BLOCKED decision. PASS requires actual execution in the target environment; an automated unit-test green status may support, but cannot replace, customer observation.

| ID | Flow / acting role | Expected acceptance evidence |
| --- | --- | --- |
| HR-01 | HR Ops: create Person, Employment, Position, org structure | Stable golden-record relationships; no conflated employee/position history |
| HR-02 | HR Ops: transfer or promotion (immediate) | Signed impact preview, current relationship recheck, audit and new correct position |
| HR-03 | HR Ops: future-dated transfer | No early mutation; scheduler applies once at effective date with preserved history |
| HR-04 | Manager/HRBP: employee selectors and 360 | Only authorized population; hidden outside relationship/grant boundary |
| REC-01 | Recruiter: requisition → candidate → application → offer | Reviewed state transitions and source/audit continuity |
| REC-02 | HR Ops: approved offer → hire → onboarding | No duplicate golden record; correct employment and onboarding tasks |
| REC-03 | HR Ops: onboarding evidence/readiness | Task ownership, due dates, completion evidence and notifications agree |
| WORK-01 | Employee/Manager: time entry and approval | Authorizations and submitted/approved/locked states remain consistent |
| WORK-02 | Employee/Manager: leave request and decision | Period entitlement, balance, delegate/manager boundaries and audit intact |
| WORK-03 | HR Ops: benefits coverage lifecycle | Pending → active/suspended/waived/ended, effective dates and history |
| COMP-01 | Compensation Admin: approved change | Separate request/approver; previous compensation history retained |
| PAY-01 | Payroll Admin: restricted period/run review | Audit, access denial for unrelated roles, reconciled ledger; NO claim of statutory tax completeness |
| PERF-01 | Employee/Manager: goal → review → calibration | Human assessor identity, allowed stage transitions, rationale and closed-cycle controls |
| TAL-01 | Talent Admin: talent assessment → correction | Create-only first decision, explicit correction rationale, immutable evidence trail |
| SUC-01 | Succession owner: candidate/rank/readiness review | Human readiness decision and owner/rank scope remain enforced |
| LEARN-01 | HR Ops: create mandatory training obligation | One open employee-course assignment only, including cross-source creation paths |
| LEARN-02 | Employee: start → complete with certificate/score | Self identity, bounded evidence, completion timestamp and read-only history |
| LEARN-03 | HR Ops: waive training with human reason | Waiver timestamp, decision actor and justification; no self-waiver |
| LEARN-04 | Talent owner: post-learning reassessment | Completed evidence triggers active linked plan/candidate human review only; stale/inactive links do not notify |
| LEARN-05 | Talent owner: development plan completion | New human skill assessment after latest completed training where target evidence is required; no automatic promotion |
| LINK-01 | Employee/Manager: in-app notification deep links | Benefits, Performance, Talent, Learning and Succession links focus exact authorized record, not a generic workspace |
| WORKFLOW-01 | Assigned user: Action Center task | Only correct role/assignee can decide; action state, notification badge and history update |
| SERVICE-01 | HR Service: intake → ownership → SLA escalation | Queue ownership, SLA warnings/escalation, ticket audit and no cross-team leakage |
| ER-01 | Case participant: restricted case lifecycle | Explicit case-wall assignment required; unrelated HRBP/Tenant Admin cannot read details |
| DOC-01 | Authorized employee: upload/download document | PENDING/SCANNING blocked, CLEAN readable, QUARANTINED/FAILED blocked; grants and expiry respected |
| GOV-01 | Policy creator/reviewer: publish + acknowledge | Independent approval, lifecycle provenance, employee acknowledgement evidence |
| PRIV-01 | Privacy Officer: DSR and retention/legal hold | Separate restricted scope, audit, hold/retention controls and no unauthorized disclosure |
| ANALYTICS-01 | Manager/HRBP: scoped metrics | Exact population fingerprint, threshold suppression, no fallback to tenant-wide aggregates |
| AI-01 | Authorized user: decision-support request | Configured/approved processor only; no autonomous employment decision; restricted inputs blocked |

The customer may explicitly mark optional modules NOT IN PILOT, with a named owner and no commercial claim of validation for those domains. Negative tests below are never optional for a customer handling real employee data.

## Mandatory negative/security tests

- Separate tenants: tenant A credentials, API IDs, document IDs, notification links and search queries cannot expose tenant B records. Verify the API response and UI.
- Manager/HRBP: a guessed ID from outside the current authorized employee population does not bypass relationship scope or trigger a broader fallback query.
- Employee: no change to another employee's learning, leave, document, performance or notification.
- Restricted records: unrelated Tenant Admin and Manager cannot read payroll, compensation, DSR/ER evidence without appropriate explicit authorization.
- Session assurance: revoked sessions, stale MFA/trusted-device evidence, cross-origin mutations and malformed IDs fail closed; ordinary users cannot invoke internal maintenance.
- Documents: content-integrity mismatch or malware verdict cannot be bypassed by a download route or a direct object-storage URL.
- HR decisions: repeated submissions/concurrent updates yield bounded conflicts rather than silently overwriting historical decisions; notifications are deduplicated.
- No raw secrets, employee information, exception SQL or credentials in audit exports, operational metrics, GitHub artifact summaries or browser errors.

## Operations/game-day gates

| ID | Check | Evidence / acceptance |
| --- | --- | --- |
| OPS-01 | Fresh single-host installation | Preflight, revision-matched postflight, authentication, scanner, notification and migrations |
| OPS-02 | Approved upgrade with test data | Pre-upgrade snapshot, checksummed backup, migration state and verified postflight |
| OPS-03 | Disposable backup/restore rehearsal | Database and private objects restored to exact earlier state; no real production erase |
| OPS-04 | Scheduler partial failure/503 | Failure stays RED; unclassified 503 stops later jobs; no automatic POST retry; operator investigates before targeted rerun |
| OPS-05 | Audit ledger verification | Tail consistency and immutable evidence; any suspected failure investigated, never ignored |
| OPS-06 | Identity and SCIM integration | Create/deactivate/rotate with exact tenant mapping and positive/negative tests |
| OPS-07 | SMTP/notification routing (if enabled) | Provider TLS, recipient role, retry, dead letter and no sensitive email leakage |
| OPS-08 | Capacity, outage and recovery | Customer-agreed peak throughput, resource limits, RPO/RTO and outage recovery measured on representative fixture load |

Important incident: audit-integrity HTTP 503 on 14 October 2026 requires root-cause investigation (issue #209). PR #208 improves diagnostic classification; it does not certify production availability or repair unknown upstream failures.

## Defect severity and GO / NO-GO

- **BLOCKER / NO-GO**: cross-tenant or restricted-data leak, critical audit-chain invalidity, unapproved material HR decision, failed migration/restore, bypassable document scanner, missing authentication enforcement, unrecoverable HR transaction, any integrity discrepancy without remediation.
- **HIGH**: key in-scope workflow cannot finish, silent duplicate/overwrite, unreliable critical notification/maintenance without owner-approved containment, repeatable severe latency outside agreed pilot SLO.
- **MEDIUM/LOW**: bounded non-critical UI, localization or reporting defect with an explicit workaround and owner.
- Zero unresolved BLOCKER issues. Every HIGH must either be resolved and retested or the affected workflow excluded by a signed scope decision; no exception for security/privacy-critical boundaries.
- No GO without named customer HR owner, information security owner and deployment/operations owner acceptance. Keep the release commit, configuration versions, evidence index and accepted exclusions immutable with the sign-off.

## Evidence register template

Use one row per case, without raw personal data:

| Field | Example format |
| --- | --- |
| Case / environment / role | LEARN-04 / PILOT-01 / Talent Admin |
| Approved release revision | Full 40-hex commit |
| Status | NOT RUN, PASS, FAIL, BLOCKED, NOT IN PILOT |
| Date & actor | UTC timestamp and role alias |
| Expected vs observed | State transition and safe bounded assertions |
| Evidence reference | Private customer storage URI or redacted artifact + checksum |
| Incident/defect | Ticket ID, severity, remediation commit, retest |
| Sign-off | HR process owner / security / operations |

## Follow-up boundary

Automated GitHub tests and isolated disposable recovery rehearsals are engineering evidence. Actual customer environment acceptance, statutory payroll packs, contractual availability guarantees, KMS/BYOK, high-availability infrastructure and live integrations require separate scoped sign-offs. Never interpret this document as proof the pilot has already passed.

Related references: docs/PRODUCT.md, docs/SECURITY.md, docs/TALENT-AND-GROWTH-ARCHITECTURE.md, docs/ONPREM-DEPLOYMENT.md, docs/RELEASE-SUPPLY-CHAIN.md and docs/maintenance-operations.md.
