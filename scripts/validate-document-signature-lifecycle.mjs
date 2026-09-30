import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const componentPath = "components/document-signature-governance.tsx";
const component = await source(componentPath);
expect(componentPath, component, /\/api\/documents\/\$\{encodeURIComponent\(documentId\)\}\/signatures/, "signature console must use the governed document-scoped endpoint");
expect(componentPath, component, /URLSearchParams\(window\.location\.search\)/, "signature console must read exact focus without widening server scope");
expect(componentPath, component, /params\.get\("envelope"\)\?\.trim\(\)\.slice\(0,\s*128\)/, "envelope focus input must be bounded");
expect(componentPath, component, /params\.get\("document"\)\?\.trim\(\)\.slice\(0,\s*128\)/, "document focus input must be bounded");
expect(componentPath, component, /focusDocumentId === documentId/, "envelope focus must remain bound to the selected document");
expect(componentPath, component, /No broader lookup was attempted/, "unavailable focus must fail closed without a broader lookup");
expect(componentPath, component, /hrbp:lifecycle-actions-changed/, "sending an envelope must refresh shared lifecycle attention");
expect(componentPath, component, /current CLEAN document version|mevcut CLEAN doküman sürümüne/, "UI must communicate immutable CLEAN-version binding");
reject(componentPath, component, /contentHash|objectKey|scanMessage|scanReference/, "signature console must not render storage or hash internals");

const governancePath = "components/governance-live-workspace.tsx";
const governance = await source(governancePath);
expect(governancePath, governance, /can\(ctx,\s*"documents:sign"\)/, "document vault must derive signature capability from authorization");
expect(governancePath, governance, /DocumentSignatureGovernance[\s\S]*documentId=\{row\.id\}[\s\S]*canSign=\{canSign\}/, "signature console must be mounted inside the already-governed document row");

const continuityPath = "lib/document-signature-action-continuity.ts";
const continuity = await source(continuityPath);
expect(continuityPath, continuity, /can\(ctx,\s*"documents:sign"\)[\s\S]*can\(ctx,\s*"documents:read"\)/, "signature follow-up must require read and sign authority");
expect(continuityPath, continuity, /createdById:\s*ctx\.actorId/, "signature follow-up must be bound to the signed envelope owner");
expect(continuityPath, continuity, /SignatureEnvelopeStatus\.SENT[\s\S]*SignatureEnvelopeStatus\.IN_PROGRESS/, "only active sent/in-progress envelopes may create follow-up attention");
expect(continuityPath, continuity, /documentVisibilityWhere\(db,\s*ctx\)/, "signature follow-up must reapply governed document visibility");
expect(continuityPath, continuity, /href:\s*`\/module\/documents\?document=.*&envelope=/, "attention must deep-link to exact governed document + envelope focus");
expect(continuityPath, continuity, /take:\s*100/, "signature attention queries must remain bounded");
expect(continuityPath, continuity, /kind:\s*"documents"/, "signature follow-up must reuse the existing documents privacy/summary boundary");
expect(continuityPath, continuity, /documentSignatureDegraded/, "signature aggregation must fail soft without suppressing the core Action Center");
reject(continuityPath, continuity, /contentHash|objectKey|scanMessage|scanReference|email:\s*true|employmentId:\s*true/, "Action Center signature aggregation must not load signer identity or storage evidence");

// The Action Center may add newer continuity layers above Documents. Validate that
// the current top-level Recruiting wrapper extends, rather than bypasses, signature continuity.
const recruitingContinuityPath = "lib/recruiting-action-center-continuity.ts";
const recruitingContinuity = await source(recruitingContinuityPath);
expect(recruitingContinuityPath, recruitingContinuity, /getDocumentSignatureLifecycleActionCenterData\(ctx\)/, "the top-level lifecycle wrapper must preserve document-signature continuity");
expect(recruitingContinuityPath, recruitingContinuity, /documentSignatureDegraded:\s*base\.documentSignatureDegraded/, "the top-level wrapper must preserve signature degradation state");

const apiPath = "app/api/action-center/route.ts";
const api = await source(apiPath);
expect(apiPath, api, /recruiting-action-center-continuity/, "Action Center API must use the current top-level continuity wrapper that contains signature continuity");

const dashboardPath = "lib/dashboard-lifecycle-attention.ts";
const dashboard = await source(dashboardPath);
expect(dashboardPath, dashboard, /recruiting-action-center-continuity/, "Dashboard must use the same current governed continuity source");
reject(dashboardPath, dashboard, /SignatureEnvelope|documentVersion|participants|contentHash/, "Dashboard must remain aggregate-only");

const analyticsPath = "lib/lifecycle-analytics-continuity.ts";
const analytics = await source(analyticsPath);
expect(analyticsPath, analytics, /recruiting-action-center-continuity/, "Analytics must use the same current governed continuity source");
reject(analyticsPath, analytics, /SignatureEnvelope|documentVersion|participants|contentHash/, "Analytics must not project signature evidence");

if (failures.length) {
  console.error("Document signature lifecycle validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Document signature lifecycle validation passed.");
