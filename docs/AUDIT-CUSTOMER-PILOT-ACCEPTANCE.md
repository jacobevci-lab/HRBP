# HRBP audit evidence — customer pilot acceptance gates

Status: **NOT APPROVED / NO-GO by default**. This runbook is a decision framework, not evidence that a customer deployment is compliant. Applies to #215 and the synthetic audit/checkpoint/timestamp/retention work stacked through #232. No customer keys, records, certificates, accounts, or retention stores are part of repository CI.

## Decision rules

- A named customer security owner and an independent compliance/records owner must sign off on the **exact deployed revision**, deployment identifier, retention schedule and trust anchors. An engineer's test result cannot replace this approval.
- Missing, expired, unverifiable or contradictory evidence is **NO-GO**. A provider receipt, operator acknowledgement, local timestamp, or green CI alone is never proof of external enforcement.
- Evidence should identify a cryptographic digest and secure evidence locator, not contain employee payloads, secrets, raw tenant identifiers, private keys, access tokens or database connection strings.
- The HRBP service must not be given signer or retention-controller credentials. An operator acknowledgement flag is not evidence of organizational separation.

## Required independent gates

| Gate | Evidence required | Failure / owner |
| --- | --- | --- |
| G01 — Source-to-deploy provenance | Exact source SHA, successful GitHub security/build checks, **successful Cloudflare provider build and deployed Worker Version ID**, independent runtime revision readback | Block if provider build is red or runtime revision is unknown. Platform owner. See #220 |
| G02 — Operator key custody | Approved key-generation procedure, key inventory/fingerprint, custody owner, access reviews, HSM/KMS attestation if mandated, rotation/revocation drill | Block for unknown custody or unapproved software key storage. Security + key custodian |
| G03 — Trusted timestamp | TSA contract/policy approval, independently pinned root SHA-256 and policy OID, actual RFC3161 DER request/response, nonce/imprint and archival-byte checks, CA validation, expiry/revocation/LTV policy | Block for self-issued test CA, absent TSA accreditation approval or failed validation. PKI owner |
| G04 — External retention | Approved retention class and jurisdiction, Object Lock compliance/vault-lock policy and administrative bypass analysis, signed provider-side configuration snapshot, independently observed object version and retain-until deadline, legal hold handling and proof deletion/bypass is denied | Block if evidence is only the opaque operator-attested receipt from #232. Storage + legal owner |
| G05 — Chain completeness | Representative tenant enrollment inventory, bounded tail and completed full-history coverage, signed checkpoint, archive and independently pinned evidence digests; missed schedule and tenant churn recovery | Block on gaps, stale verification or unmatched digest. Audit operator |
| G06 — Forensic incident response | Read-only triage, alert routing, evidence-preserving isolation, legal chain of custody, tamper/truncation detection, known-good restoration **only in separately approved disaster-recovery procedure** | Block on silent repair/backfill, destructive retries or unresolved detection gaps. Incident commander |
| G07 — Restore and scale | Customer-like dataset, observed throughput, p95/p99 runtime, PostgreSQL budgets, backup/restore test, measured RPO/RTO and repeatability | Block if only the 8-tenant/256-event CI rehearsal is available. SRE + customer owner |
| G08 — Legal/privacy | Retention schedule and lawful basis, data residency, access/export controls, privacy review, evidence redaction policy, deletion exceptions, signed acceptance | Block until approved. Legal/privacy owner |
| G09 — Operational reliability | Repeated scheduled cycles, no unexplained 503, edge and DB correlation with redacted IDs, controlled alert and escalation runbook | Block on unresolved recurrence; #209 remains open. SRE + security owner |
| G10 — Customer sign-off | Recorded named owner approvals, customer test results and GO/NO-GO minutes with expiry/revalidation date | Block absent explicit sign-off. Customer sponsor |

## Evidence manifest for each acceptance attempt

Maintain an access-controlled, append-only decision record with these fields (use controlled references, never paste secrets):

```json
{
  "schemaVersion": 1,
  "decision": "NO_GO",
  "decisionAtUtc": null,
  "customerReference": "<approved pseudonymous reference>",
  "sourceCommitSha": null,
  "deployedWorkerVersionId": null,
  "approvedRetentionUntilUtc": null,
  "evidence": [
    {
      "gate": "G01",
      "status": "MISSING",
      "sha256": null,
      "controlledLocator": null,
      "reviewerRole": null,
      "reviewedAtUtc": null
    }
  ],
  "customerSecurityApproval": null,
  "recordsLegalApproval": null,
  "nextReviewAtUtc": null
}
```

An automated collector MUST NOT mark a gate PASS based solely on a file's existence. Signed manifests and hashes verify binding/integrity only, not external authority, effective immutability or customer acceptance.

## Operating sequence

1. Freeze source and independently establish **actual deployment identity**. Do not equate OpenNext dry-run with successful Cloudflare deployment.
2. Enroll independent signer trust keys and retention controller; record identity, governance, key custody, rotation and revocation. Ensure disjoint operational permissions.
3. Create and verify customer-approved checkpoint and archive with an approved read-only DB role, then acquire and reverify the **real approved TSA** token over canonical archival bytes.
4. Configure real provider retention through separately approved storage operations; independently read back provider version, mode and retention deadline. Perform denied-delete/overwrite checks **only on dedicated safe test objects**, never production evidence.
5. Validate the #232 retention evidence binding against independently pinned source digests. Treat its `OPERATOR_ATTESTED_PROVIDER_RECEIPT` assurance as insufficient for G04 without provider-enforcement observations.
6. Execute failure recovery, alerting, full-history coverage, missed-run, large-dataset and cross-tenant access isolation tests; record bounded measurements.
7. Obtain customer/legal approvals and publish a signed GO/NO-GO decision. Any revised key, TSA policy, deployed commit, retention policy or material provider configuration reopens relevant gates.

## Known open blockers at publication

- #220: Cloudflare Workers provider build failure and deployed version have not been independently established.
- #209: intermittent audit maintenance 503 root cause not established.
- #215: external customer acceptance, real HSM/KMS custody, approved TSA policy and proven WORM/Object Lock enforcement are **not** discharged by synthetic CI.
- #231 and #233 represent overlapping RFC3161 implementations; select a single approved contract before presenting a complete end-to-end customer evidence chain.
- #232 is a provider-neutral cryptographic binding for **opaque** retention receipts. It does not verify vendor semantics or enforce lock configuration.

No production release or customer sign-off is authorized by this document.
