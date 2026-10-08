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
expect(helperPath, helper, /tenantId:\s*input\.tenantId[\s\S]*actorId:\s*input\.actorId[\s\S]*personId:\s*input\.personId[\s\S]*employmentId:\s*input\.employmentId[\s\S]*sourcePositionId:\s*input\.sourcePositionId[\s\S]*targetPositionId:\s*input\.targetPositionId/, "preview receipt must bind tenant, actor, employee and source/target state");
expect(helperPath, helper, /claims\.tenantId\s*!==\s*expected\.tenantId[\s\S]*claims\.actorId\s*!==\s*expected\.actorId[\s\S]*claims\.personId\s*!==\s*expected\.personId[\s\S]*claims\.targetPositionId\s*!==\s*expected\.targetPositionId/, "receipt verification must reject identity or target drift");
expect(helperPath, helper, /claims\.reasonDigest\s*!==\s*digestReason\(expected\.reason\)/, "receipt verification must reject reason drift");

const previewPath = "app/api/people/[personId]/lifecycle/position/preview/route.ts";
const preview = await source(previewPath);
expect(previewPath, preview, /can\(ctx,\s*"people:write"\)[\s\S]*can\(ctx,\s*"positions:write"\)/, "impact preview must require the same mutation capabilities as apply");
expect(previewPath, preview, /mutationOriginAllowed\(request\)/, "impact preview must reject cross-origin mutation requests");
expect(previewPath, preview, /status:\s*PositionStatus\.OPEN/, "impact preview must inspect only the current open target position");
expect(previewPath, preview, /NOT:\s*\{\s*id:\s*employment\.id\s*\}/, "impact preview must detect another incumbent");
expect(previewPath, preview, /tx\.requisition\.count[\s\S]*status:\s*\{\s*in:\s*openRequisitionStatuses\s*\}/, "impact preview must surface open recruiting demand on the target position");
expect(previewPath, preview, /DIRECT_REPORT_RELATIONSHIPS_UNCHANGED[\s\S]*MANAGER_RELATIONSHIP_UNCHANGED[\s\S]*TARGET_REQUISITIONS_REMAIN_OPEN[\s\S]*TARGET_POSITION_IS_CRITICAL/, "impact preview must surface the governed relationship warnings");
expect(previewPath, preview, /createPositionChangePreviewReceipt/, "impact preview must return a signed short-lived receipt");

const applyPath = "app/api/people/[personId]/lifecycle/position/route.ts";
const apply = await source(applyPath);
expect(applyPath, apply, /asText\(body\.previewReceipt,\s*8192\)/, "apply must require a bounded preview receipt");
expect(applyPath, apply, /verifyPositionChangePreviewReceipt/, "apply must cryptographically verify the preview receipt");
expect(applyPath, apply, /preview\.employmentId\s*!==\s*employment\.id[\s\S]*preview\.sourcePositionId\s*!==\s*employment\.positionId/, "apply must invalidate preview when current employment state changed");
expect(applyPath, apply, /TARGET_NOT_OPEN[\s\S]*TARGET_OCCUPIED/, "apply must recheck target vacancy after preview");
expect(applyPath, apply, /PREVIEW_REQUIRED[\s\S]*PREVIEW_STALE/, "apply must return controlled conflicts for expired or stale preview evidence");
expect(applyPath, apply, /tx\.employment\.update[\s\S]*tx\.position\.update[\s\S]*employeeLifecycleEvent\.create[\s\S]*appendAudit/, "apply must keep employment, position, lifecycle and audit writes in one transaction");

const componentPath = "components/employee-lifecycle-console.tsx";
const component = await source(componentPath);
expect(componentPath, component, /\/lifecycle\/position\/preview/, "employee lifecycle UI must request impact preview before apply");
expect(componentPath, component, /previewReceipt:\s*preview\.receipt/, "employee lifecycle UI must send the signed receipt on apply");
expect(componentPath, component, /setPreview\(null\)[\s\S]*targetPositionId,\s*eventType,\s*effectiveAt,\s*reason/, "changing reviewed inputs must invalidate the prior preview");
expect(componentPath, component, /Review impact|Etkiyi incele/, "UI must expose an explicit impact review step");
expect(componentPath, component, /Confirm and apply promotion|Terfiyi onayla ve uygula/, "UI must separate preview from final confirmation");

const testPath = "scripts/job-change-impact-preview.test.mjs";
const tests = await source(testPath);
expect(testPath, tests, /preview receipt rejects field drift and token tampering/, "behavioral test must cover tampering and field drift");
expect(testPath, tests, /preview receipt expires after ten minutes/, "behavioral test must cover expiry");

if (failures.length) {
  console.error("Job-change impact preview validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Job-change impact preview validation passed.");
