import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const accessPath = "lib/recruiting-access.ts";
const access = await source(accessPath);
expect(accessPath, access, /hasTenantRecruitingVisibility[\s\S]*recruiting:write/, "tenant-wide recruiting visibility must require recruiting write authority");
expect(accessPath, access, /hiringManagerId:\s*ctx\.actorId/, "read-only recruiting users must be restricted to requisitions they own");
expect(accessPath, access, /applications:\s*\{\s*some:[\s\S]*hiringManagerId:\s*ctx\.actorId/, "candidate visibility must derive from an owned requisition");

const livePath = "lib/recruiting-live-data.ts";
const live = await source(livePath);
expect(livePath, live, /getRecruitingWorkspaceData\(ctx:\s*RequestContext\)/, "recruiting live data must receive the signed request context");
expect(livePath, live, /recruitingRequisitionReadFilter\(ctx\)/, "requisition metrics and rows must use recruiting access scope");
expect(livePath, live, /recruitingApplicationReadFilter\(ctx\)/, "candidate pipeline must use recruiting access scope");
expect(livePath, live, /requisitionId:\s*\{\s*in:\s*requisitionIds\s*\}/, "applications must be pinned to already-authorized requisitions");
expect(livePath, live, /id:\s*\{\s*in:\s*userIds\s*\}/, "recruiting user names must only load identities referenced by visible requisitions");
expectAbsent(livePath, live, /workspaceTenantId/, "authenticated recruiting live data must not rely on a workspace-wide tenant fallback");
expect(livePath, live, /resolveOnboardingPopulationScope\(db,\s*ctx\)/, "onboarding live data must resolve employment population scope");
expect(livePath, live, /onboardingPlanPopulationFilter\(scope\)/, "onboarding plans must apply the same population filter as onboarding APIs");
expect(livePath, live, /id:\s*\{\s*in:\s*ownerIds\s*\}/, "onboarding owner identities must be limited to visible plans");

const onboardingOpsPath = "lib/onboarding-operations-data.ts";
const onboardingOps = await source(onboardingOpsPath);
expect(onboardingOpsPath, onboardingOps, /getOnboardingOperationsData\(ctx:\s*RequestContext\)/, "onboarding operations must receive request context");
expect(onboardingOpsPath, onboardingOps, /resolveOnboardingPopulationScope\(db,\s*ctx\)/, "onboarding operations must resolve employment scope");
expect(onboardingOpsPath, onboardingOps, /onboardingPlanPopulationFilter\(scope\)/, "onboarding operations must filter visible plans before exposing tasks");

const workspacePath = "components/recruiting-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /getRecruitingWorkspaceData\(ctx\)/, "recruiting workspace must pass signed request context to live data");
expect(workspacePath, workspace, /getOnboardingWorkspaceData\(ctx\)/, "onboarding workspace must pass signed request context to live data");
expect(workspacePath, workspace, /getOnboardingOperationsData\(ctx\)/, "onboarding operations console must use the same signed scope");
expectAbsent(workspacePath, workspace, /getRecruitingWorkspaceData\(ctx\.tenantId\)|getOnboardingWorkspaceData\(ctx\.tenantId\)|getOnboardingOperationsData\(ctx\.tenantId\)/, "live read helpers must never be called with tenant id alone");

const requisitionApiPath = "app/api/recruiting/requisitions/route.ts";
const requisitionApi = await source(requisitionApiPath);
expect(requisitionApiPath, requisitionApi, /where:\s*recruitingRequisitionReadFilter\(ctx\)/, "requisition API GET must enforce manager ownership scope");

const candidateApiPath = "app/api/recruiting/candidates/route.ts";
const candidateApi = await source(candidateApiPath);
expect(candidateApiPath, candidateApi, /where:\s*recruitingCandidateReadFilter\(ctx\)/, "candidate API GET must filter candidate identities by recruiting scope");
expect(candidateApiPath, candidateApi, /applications:\s*\{[\s\S]*where:\s*recruitingApplicationRelationFilter\(ctx\)/, "nested candidate applications must not disclose other requisitions");
expect(candidateApiPath, candidateApi, /const\s+privileged\s*=\s*hasTenantRecruitingVisibility\(ctx\)/, "candidate personal-data expansion must derive from tenant recruiting authority");
expect(candidateApiPath, candidateApi, /\.\.\.\(privileged\s*\?\s*\{\s*email:\s*true,\s*retentionUntil:\s*true\s*\}\s*:\s*\{\}\)/, "candidate email and retention metadata must be omitted from read-only manager responses");

if (failures.length) {
  console.error("Recruiting/onboarding access contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated recruiting/onboarding privacy contract: manager candidate visibility is requisition-owned, read-only candidate personal data is minimized, onboarding reads and operations are employment-scoped, and tenant-wide identity lookups are minimized.");
