# Offline audit pilot packet preflight

This tool checks the completeness and chronology of **declared metadata** for the
G01-G10 gates in `AUDIT-CUSTOMER-PILOT-ACCEPTANCE.md`. It does not authenticate
signatures, fetch the referenced artifacts, verify their bytes against SHA-256,
inspect the provider, or establish reviewer identity. Neither output nor exit
code authorizes a deployment. The controlled decision record in that runbook is
not the CLI input schema: in particular, the CLI rejects a supplied `decision`.

## Run and interpret

Use an operator-controlled POSIX host and directory with the repository's pinned
Node version. No package installation, database, network access or secret is needed
for this preflight or its test suite.

```sh
node scripts/audit-pilot-gate-evaluator.mjs /approved/local/pilot-packet.json
npm run audit-pilot:validate
```

- `NO_GO`, exit 1: declaration rejected, with bounded reason codes.
- `READY_FOR_INDEPENDENT_AUTHORIZATION`, exit 0: metadata preflight passed only.
  Independently authenticate the supporting evidence and obtain the actual release
  decision. A fabricated but internally consistent declaration can still pass.
- File/argument/JSON errors: exit 1, a generic `PACKET_INVALID` JSON on stderr.
  No raw paths, packet content or stack traces are emitted.

`passCount` counts only evidence entries that pass their individual checks,
including the special G01/G03/G04 evidence-type rules. It is **not** an approval
count. A packet can have ten individually passing entries and still be `NO_GO`
because the overall approval or decision window is invalid.

## Exact input contract (schemaVersion 1)

All fields below are mandatory; additional fields are rejected. The input is a
single JSON object, not a signed envelope. Use canonical UTC dates such as
`2026-10-27T20:00:00.000Z`; these dates are declarations, not trusted timestamps.

Top-level fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Integer `1` |
| `customerReference` | Approved pseudonymous reference, 8-96 letters/digits/underscore/hyphen |
| `sourceCommitSha` | 40 lowercase hexadecimal characters; syntactic identity only |
| `deployedWorkerVersionId` | 8-128 letters/digits/dot/underscore/colon/hyphen; not a provider readback |
| `decisionAtUtc` | Declared decision time, not future or more than 90 days old |
| `nextReviewAtUtc` | Future review, after the decision, no more than 90 days after it and no later than retention expiry |
| `approvedRetentionUntilUtc` | Future declared retention deadline |
| `evidence` | Exactly ten entries, one each for G01 through G10 |
| `customerSecurityApproval` | Approval object for `CUSTOMER_SECURITY` |
| `recordsLegalApproval` | Approval object for `LEGAL_RECORDS` |

Each evidence object has exactly `gate`, `status`, `sha256`, `controlledLocator`,
`reviewerRole`, `reviewerReference`, `reviewedAtUtc`, and `evidenceType`.
`status` must be `PASS` to pass; `FAIL`, `MISSING` and `EXPIRED` are recognized
non-passing declarations. `sha256` is a 64-character lowercase hex declaration,
not a computed file hash. Locator/reviewer/type references use the same 8-96
character reference alphabet as `customerReference`. The reviewer role is a
4-64-character uppercase letter/digit/underscore label starting with a letter.

Special declared evidence types are `DEPLOYED_REVISION_READBACK` for G01,
`APPROVED_TSA_RFC3161` for G03 and `INDEPENDENT_PROVIDER_LOCK_READBACK` for G04.
These names constrain the declaration; typing a name does not verify its truth.

Each approval object has exactly `reviewerRole`, `reviewerReference`,
`approvedAtUtc`, and `evidenceSha256`. Security and records references must differ;
the references do not independently establish that two different people approved.

Chronology must be: every evidence review <= both approvals <= decision <= now.
Evidence and approvals must each be no more than 90 days old. Chronology and the
90-day window are preflight policy, not legal retention requirements.

## File boundary

The reader opens one descriptor using `O_NOFOLLOW | O_NONBLOCK`, checks it is a
nonempty regular single-link file of at most 64 KiB before reading, and reads at
most 64 KiB + 1 bytes. It compares descriptor metadata before and after reading,
rejects detected changes, and strictly decodes UTF-8. Symlinks in the final path
component, hard-linked files, directories, FIFOs, invalid UTF-8 and BOMs fail.
Parent directories must remain operator-controlled. This is not a file lock,
sandbox, immutable archive, or a guarantee against a privileged concurrent writer.

## CI boundary

`audit-pilot:validate` runs the evaluator and CI-contract tests without installing
dependencies. `audit-integrity:validate` invokes it, so the existing production
`prebuild` chain includes it. The separate **Audit Pilot Gate** workflow runs for
all pull-request target branches (including stacked draft PRs) and pushes to
main. It has a read-only token, no secrets, no deploy step and no failure bypass.

This workflow does not replace CI, Security Assurance, Platform Regression or
Release Verification. Repository administrators must separately configure a
required status check for **Audit pilot evidence preflight** if they require GitHub
merge blocking; no branch-protection or ruleset change is made here. Successful
preflight tests do not resolve #209, #220, production TSA/WORM/key custody, or
customer/legal authorization.
