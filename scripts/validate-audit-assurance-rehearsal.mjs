import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rehearsalPath = "scripts/audit-assurance-rehearsal.postgres.test.mjs";
const workflowPath = ".github/workflows/ci.yml";
const packagePath = "package.json";
const [rehearsal, workflow, pkg] = await Promise.all([
  readFile(rehearsalPath, "utf8"),
  readFile(workflowPath, "utf8"),
  readFile(packagePath, "utf8")
]);

function expect(source, pattern, message) { assert.match(source, pattern, message); }
function reject(source, pattern, message) { assert.doesNotMatch(source, pattern, message); }

expect(rehearsal, /const TENANTS = 8;/, "rehearsal must preserve the agreed multi-tenant fixture size");
expect(rehearsal, /const CHECKPOINT_EVENTS = 24;/, "checkpoint depth must remain representative and bounded");
expect(rehearsal, /const FINAL_EVENTS = 32;/, "post-checkpoint append coverage must remain explicit");
expect(rehearsal, /HRBP_DISPOSABLE_AUDIT_LEDGER_TEST/, "rehearsal must stay explicitly gated to disposable CI");
expect(rehearsal, /dbUrl\.pathname, "\/hrbp"/, "rehearsal must refuse non-disposable database names");
expect(rehearsal, /createAuditCheckpoint\(/, "rehearsal must create retained signed anchors");
expect(rehearsal, /compareAuditCheckpoint\(/, "rehearsal must compare against retained anchors");
expect(rehearsal, /fullyRehashTenant\(/, "privileged full-chain rewrite scenario must remain");
expect(rehearsal, /CHECKPOINT_HASH_MISMATCH/, "rewrite must be detected by the retained anchor");
expect(rehearsal, /truncateTenant\(/, "truncation scenario must remain");
expect(rehearsal, /CHECKPOINT_SEQUENCE_MISSING/, "truncation below the checkpoint must fail closed");
expect(rehearsal, /restoreExactTenant\(/, "exact forensic restore scenario must remain");
expect(rehearsal, /restoredVerified: 2/, "both corrupted tenants must be reverified after exact restore");
expect(rehearsal, /AUDIT_ASSURANCE_REHEARSAL/, "aggregate rehearsal evidence must be emitted");
expect(rehearsal, /assert\.ok\(!serialized\.includes\(tenant\.id\)\)/,
  "aggregate report must not expose synthetic tenant identifiers");
expect(rehearsal, /assert\.ok\(!serialized\.includes\(runId\)\)/,
  "aggregate report must not expose the run identifier");
reject(rehearsal, /process\.env\.DATABASE_URL\s*=|https?:\/\//,
  "rehearsal must not redirect itself to external services or databases");

expect(workflow, /node --test scripts\/audit-assurance-rehearsal\.postgres\.test\.mjs/,
  "real PostgreSQL reassurance must remain a mandatory CI integration gate");
expect(pkg, /audit-assurance:validate/, "static assurance contract must be reachable through package validation");

console.log("Audit assurance rehearsal contract: multi-tenant checkpoint, rewrite/truncation detection and exact restore verified.");
