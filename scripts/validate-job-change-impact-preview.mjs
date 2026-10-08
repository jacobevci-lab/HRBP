import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) {
  if (!pattern.test(text)) failures.push(path + ": " + message);
}

const helperPath = "lib/employee-position-change-preview.ts";
const helper = await source(helperPath);
expect(helperPath, helper, /exp\s*=\s*issuedAt\s*\+\s*10\s*\*\s*60/, "preview receipt must expire after ten minutes");
expect(helperPath, helper, /reasonDigest:\s*digestReason\(input\.reason\)/, "preview receipt must bind the business reason without storing it");
expect(helperPath, helper, /positionChangeImpactDigest[\s\S]*createHash\("sha256"\)\.update\(JSON\.stringify\(input\)/, "impact state must be represented by a deterministic digest");
expect(helperPath, helper, /impactDigest:\s*input\.impactDigest/, "signed preview receipt must carry the reviewed impact digest");
expect(helperPath, helper, /tenantId:\s*input\.tenantId[\s\S]*actorId:\s*input\.actorId[\s\S]*personId:\s*input\.personId[\s\S]*employmentId:\s*input\.employmentId[\s\S]*sourcePositionId:\s*input\.sourcePositionId[\s\S]*targetPositionId:\s*input\.targetPositionId/, "preview receipt must bind tenant, actor, employee and source/target state");
expect(helperPath, helper, /claims\.tenantId\s*!==\s*expected\.tenantId[\s\S]*claims\.actorId\s*!==\s*expected\.actorId[\s\S]*claims\.personId\s*!==\s*expected\.personId[\s\S]*claims\.targetPositionId\s*!==\s*expected\.targetPositionId/, "receipt verification must reject identity or target drift");
expect(helperPath, helper, /claims\.reasonDigest\s*!==\s*digestReason\(expected\.reason\)/, "receipt verification must reject reason drift");

const previewPath = "app/api/people/[personId]/lifecycle/position/preview/route.ts";
const preview = await source(previewPath);
expect(previewPath, preview, /can\(ctx,\s*"people:write"\)[\s\S]*can\(ctx,\s*"positions:write"\)/, "impact preview must require the same mutation capabilities as apply");
expect(previewPath, preview, /mutationOriginAllowed\(request\)/, "impact preview must reject cross-origin mutation requests");
expect(previewPath, preview, /target\.status\s*!==\s*PositionStatus\.OPEN/, "impact preview must reject a target position that is no longer open");
expect(previewPath, preview, /NOT:\s*\{\s*id:\s*employment\.id\s*\}/, "impact preview must detect another incumbent");
expect(previewPath, preview, /tx\.requisition\.count[\s\S]*status:\s*\{\s*in:\s*openRequisitionStatuses\s*\}/, "impact preview must surface open recruiting demand on the target position");
expect(previewPath, preview, /DIRECT_REPORT_RELATIONSHIPS_UNCHANGED[\s\S]*MANAGER_RELATIONSHIP_UNCHANGED[\s\S]*TARGET_REQUISITIONS_REMAIN_OPEN[\s\S]*GRADE_CHANGE_REQUIRES_COMPENSATION_REVIEW[\s\S]*LOCATION_CHANGE_REQUIRES_POLICY_REVIEW[\s\S]*TARGET_POSITION_IS_CRITICAL/, "impact preview must surface the governed relationship warnings");
expect(previewPath, preview, /positionChangeImpactDigest[\s\S]*createPositionChangePreviewReceipt[\s\S]*impactDigest/, "impact preview must sign the exact reviewed relationship-impact state");

const applyPath = "app/api/people/[personId]/lifecycle/position/route.ts";
const apply = await source(applyPath);
expect(applyPath, apply, /asText\(body\.previewReceipt,\s*8192\)/, "apply must require a bounded preview receipt");
expect(applyPath, apply, /verifyPositionChangePreviewReceipt/, "apply must cryptographically verify the preview receipt");
expect(applyPath, apply, /positionChangeImpactDigest[\s\S]*preview\.employmentId\s*!==\s*employment\.id[\s\S]*preview\.sourcePositionId\s*!==\s*employment\.positionId[\s\S]*preview\.impactDigest\s*!==\s*impactDigest/, "apply must invalidate preview when current employment or reviewed impact state changed");
expect(applyPath, apply, /TARGET_NOT_OPEN[\s\S]*TARGET_OCCUPIED/, "apply must recheck target vacancy after preview");
expect(applyPath, apply, /PREVIEW_REQUIRED[\s\S]*PREVIEW_STALE/, "apply must return controlled conflicts for expired or stale preview evidence");
expect(applyPath, apply, /tx\.employment\.update[\s\S]*tx\.position\.updateMany[\s\S]*employeeLifecycleEvent\.create[\s\S]*appendAudit/, "apply must keep employment, position, lifecycle and audit writes in one transaction");
expect(applyPath, apply, /position\.updateMany[\s\S]*status:\s*PositionStatus\.OPEN[\s\S]*targetClaim\.count\s*!==\s*1/, "target position claim must use an optimistic OPEN-state guard");
expect(applyPath, apply, /TransactionIsolationLevel\.Serializable/, "job-change apply must serialize concurrent target-position claims");

const componentPath = "components/employee-lifecycle-console.tsx";
const component = await source(componentPath);
expect(componentPath, component, /\/lifecycle\/position\/preview/, "employee lifecycle UI must request impact preview before apply");
expect(componentPath, component, /previewReceipt:\s*preview\.receipt/, "employee lifecycle UI must send the signed receipt on apply");
expect(componentPath, component, /setPreview\(null\)[\s\S]*targetPositionId,\s*eventType,\s*effectiveAt,\s*reason/, "changing reviewed inputs must invalidate the prior preview");
expect(componentPath, component, /Review impact|Etkiyi incele/, "UI must expose an explicit impact review step");
expect(componentPath, component, /Confirm and apply promotion|Terfiyi onayla ve uygula/, "UI must separate preview from final confirmation");

const schedulePath = "app/api/people/[personId]/lifecycle/position/schedule/route.ts";
const schedule = await source(schedulePath);
expect(schedulePath, schedule, /verifyPositionChangePreviewReceipt/, "scheduled job changes must require the same signed reviewed preview evidence");
expect(schedulePath, schedule, /ScheduledPositionChangeStatus\.PENDING[\s\S]*employmentId[\s\S]*targetPositionId/, "scheduling must reject pending employment or target reservations");
expect(schedulePath, schedule, /positionChangeImpactDigest[\s\S]*preview\.impactDigest/, "scheduling must bind the persisted request to the reviewed impact digest");
expect(schedulePath, schedule, /TransactionIsolationLevel\.Serializable/, "scheduled job-change creation must serialize conflicting reservations");
expect(schedulePath, schedule, /at most 365 days|365 \* 24 \* 60 \* 60/, "scheduled job changes must have a bounded future horizon");

const cancelPath = "app/api/people/[personId]/lifecycle/position/schedule/[id]/route.ts";
const cancel = await source(cancelPath);
expect(cancelPath, cancel, /status:\s*ScheduledPositionChangeStatus\.PENDING[\s\S]*ScheduledPositionChangeStatus\.CANCELLED/, "only pending scheduled changes may be cancelled");
expect(cancelPath, cancel, /appendAudit/, "scheduled cancellation must be audited");

const schedulerPath = "lib/scheduled-position-changes.ts";
const scheduler = await source(schedulerPath);
expect(schedulerPath, scheduler, /status:\s*ScheduledPositionChangeStatus\.PENDING[\s\S]*effectiveAt:\s*\{\s*lte:\s*now\s*\}/, "maintenance must select only due pending job changes");
expect(schedulerPath, scheduler, /currentImpactDigest[\s\S]*change\.impactDigest[\s\S]*IMPACT_STATE_CHANGED/, "automation must fail closed when reviewed impact state changes");
expect(schedulerPath, scheduler, /TARGET_POSITION_OCCUPIED[\s\S]*TARGET_STATE_CONFLICT/, "automation must block target occupancy or claim races");
expect(schedulerPath, scheduler, /ScheduledPositionChangeStatus\.APPLIED[\s\S]*employeeLifecycleEvent\.create[\s\S]*appendAudit/, "successful scheduled application must persist schedule, lifecycle and audit evidence");
expect(schedulerPath, scheduler, /EMPLOYEE_POSITION_CHANGE_BLOCKED[\s\S]*enqueueNotificationOutbox/, "blocked schedules must notify the requester without silent retries");

const maintenancePath = "lib/operational-maintenance.ts";
const maintenance = await source(maintenancePath);
expect(maintenancePath, maintenance, /runScheduledPositionChanges\(startedAt\)/, "operational maintenance must execute due scheduled job changes");

expect(componentPath, component, /\/lifecycle\/position" \+ \(scheduleMode \? "\/schedule"/, "future reviewed job changes must route to scheduling instead of immediate mutation");
expect(componentPath, component, /Scheduled job changes|Planlı iş değişiklikleri/, "employee lifecycle UI must surface scheduled job changes");
expect(componentPath, component, /cancelScheduledChange/, "employee lifecycle UI must allow cancellation of pending schedules");

const scheduledTestPath = "scripts/scheduled-job-changes.postgres.test.mjs";
const scheduledTests = await source(scheduledTestPath);
expect(scheduledTestPath, scheduledTests, /future reviewed transfer applies once when due/, "PostgreSQL coverage must prove due scheduled application");
expect(scheduledTestPath, scheduledTests, /reviewed impact drift blocks automation/, "PostgreSQL coverage must prove stale impact blocking");
expect(scheduledTestPath, scheduledTests, /cancelled schedule is never applied/, "PostgreSQL coverage must prove cancellation");

const testPath = "scripts/job-change-impact-preview.test.mjs";
const tests = await source(testPath);
expect(testPath, tests, /preview receipt rejects field drift and token tampering/, "behavioral test must cover tampering and field drift");
expect(testPath, tests, /impact digest changes when governed relationship state changes/, "behavioral test must cover impact-state drift");
expect(testPath, tests, /preview receipt expires after ten minutes/, "behavioral test must cover expiry");

if (failures.length) {
  console.error("Job-change impact preview validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Job-change impact preview validation passed.");
