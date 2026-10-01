import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const continuityPath = "lib/recruiting-action-center-continuity.ts";
const continuity = await source(continuityPath);
expect(continuityPath, continuity, /getDocumentSignatureLifecycleActionCenterData\(ctx\)/, "Recruiting must extend the current top-level lifecycle continuity chain");
expect(continuityPath, continuity, /can\(ctx,\s*"recruiting:write"\)[\s\S]*can\(ctx,\s*"recruiting:approve"\)/, "Recruiting approval attention must require both write and independent approval authority");
expect(continuityPath, continuity, /status:\s*RequisitionStatus\.APPROVAL/, "only requisitions awaiting approval may enter the queue");
expect(continuityPath, continuity, /status:\s*OfferStatus\.APPROVAL/, "only offers awaiting approval may enter the queue");
expect(continuityPath, continuity, /action:\s*"REQUISITION_CREATED"/, "requisition creator provenance must be derived from immutable audit history");
expect(continuityPath, continuity, /action:\s*"OFFER_CREATED"/, "offer creator provenance must be derived from immutable audit history");
expect(continuityPath, continuity, /!creator \|\| creator\.actorId === ctx\.actorId/, "missing provenance and self-created records must fail closed before queue projection");
expect(continuityPath, continuity, /href:\s*`\/module\/recruiting\?requisition=/, "requisition approvals must deep-link into the governed Recruiting workspace");
expect(continuityPath, continuity, /href:\s*`\/module\/recruiting\?offer=/, "offer approvals must deep-link into the governed Recruiting workspace");
expect(continuityPath, continuity, /kind:\s*"recruiting"/, "Recruiting must be a first-class Action Center source");
expect(continuityPath, continuity, /recruiting:\s*items\.filter\(\(item\) => item\.kind === "recruiting"\)\.length/, "summary must expose aggregate Recruiting attention");
expect(continuityPath, continuity, /slice\(0,\s*350\)/, "combined Action Center output must remain bounded");
reject(continuityPath, continuity, /annualBase|currency|proposedAnnualBase|currentAnnualBase|bank|accountNumber/, "central Recruiting attention must not load offer compensation or payment data");
reject(continuityPath, continuity, /\/status["'`]/, "the central Action Center must not perform Recruiting decisions directly");

const policyContinuityPath = "lib/policy-action-center-continuity.ts";
const policyContinuity = await source(policyContinuityPath);
expect(policyContinuityPath, policyContinuity, /getRecruitingLifecycleActionCenterData\(ctx\)/, "newer continuity layers must preserve Recruiting as their governed base");
expect(policyContinuityPath, policyContinuity, /recruitingDegraded:\s*base\.recruitingDegraded/, "newer continuity layers must preserve Recruiting degradation state");

const actionRoutePath = "app/api/action-center/route.ts";
const actionRoute = await source(actionRoutePath);
expect(actionRoutePath, actionRoute, /workflow-definition-action-continuity/, "the Action Center API must route through the current top-level continuity wrapper");
expect(actionRoutePath, actionRoute, /cache-control[\s\S]*no-store/, "personal action queues must remain non-cacheable");

const uiPath = "components/workflow-action-center.tsx";
const ui = await source(uiPath);
expect(uiPath, ui, /ActionKind[\s\S]*"recruiting"/, "the Action Center UI must understand Recruiting items");
expect(uiPath, ui, /allowedFilters[\s\S]*"recruiting"/, "Recruiting must be an allow-listed Action Center filter");
expect(uiPath, ui, /summary\.recruiting/, "the UI must expose the aggregate Recruiting source count");
expect(uiPath, ui, /filter === "recruiting"/, "the UI must provide a Recruiting source filter");
expect(uiPath, ui, /href=\{item\.href\}/, "Recruiting attention must stay deep-link only in the central queue");

const recruitingConsolePath = "components/recruiting-operations-console.tsx";
const recruitingConsole = await source(recruitingConsolePath);
expect(recruitingConsolePath, recruitingConsole, /for \(const type of \["requisition", "offer", "candidate", "application"\]/, "Recruiting workspace must accept exact requisition/offer deep links");
expect(recruitingConsolePath, recruitingConsole, /data-recruiting-requisition/, "requisition deep links must resolve to governed workspace records");
expect(recruitingConsolePath, recruitingConsole, /data-recruiting-offer/, "offer deep links must resolve to governed workspace records");
expect(recruitingConsolePath, recruitingConsole, /selfPrepared[\s\S]*four-eyes/, "Recruiting console must preserve the existing four-eyes lock");
expect(recruitingConsolePath, recruitingConsole, /resourceType:\s*"Requisition"/, "Requisition decisions must target the matching notification resource");
expect(recruitingConsolePath, recruitingConsole, /resourceType:\s*"Offer"/, "Offer decisions must target the matching notification resource");
expect(recruitingConsolePath, recruitingConsole, /if \(!response\.ok\) throw[\s\S]*notificationSubject[\s\S]*acknowledgeRecruitingNotification/, "notification acknowledgement must happen only after the Recruiting business mutation succeeds");
expect(recruitingConsolePath, recruitingConsole, /hrbp:notifications-changed/, "successful Recruiting notification cleanup must refresh the notification surface");
expect(recruitingConsolePath, recruitingConsole, /hrbp:lifecycle-actions-changed/, "successful Recruiting mutations must invalidate the shared lifecycle queue");
expect(recruitingConsolePath, recruitingConsole, /best-effort[\s\S]*must never roll back/, "notification cleanup must be explicitly non-transactional with the accepted Recruiting decision");

const requisitionRoutePath = "app/api/recruiting/requisitions/[id]/status/route.ts";
const requisitionRoute = await source(requisitionRoutePath);
expect(requisitionRoutePath, requisitionRoute, /can\(ctx,\s*"recruiting:approve"\)/, "requisition decisions must remain in the owning route with approval authority");
expect(requisitionRoutePath, requisitionRoute, /SELF_APPROVAL_BLOCKED/, "requisition self-approval must remain blocked by the owning domain");
expect(requisitionRoutePath, requisitionRoute, /TransactionIsolationLevel\.Serializable/, "requisition approval transitions must remain serializable");

const offerRoutePath = "app/api/recruiting/offers/[id]/status/route.ts";
const offerRoute = await source(offerRoutePath);
expect(offerRoutePath, offerRoute, /can\(ctx,\s*"recruiting:approve"\)/, "offer decisions must remain in the owning route with approval authority");
expect(offerRoutePath, offerRoute, /SELF_APPROVAL_BLOCKED/, "offer self-approval must remain blocked by the owning domain");
expect(offerRoutePath, offerRoute, /TransactionIsolationLevel\.Serializable/, "offer approval transitions must remain serializable");

const dashboardPath = "lib/dashboard-lifecycle-attention.ts";
const dashboard = await source(dashboardPath);
expect(dashboardPath, dashboard, /getWorkflowDefinitionLifecycleActionCenterData/, "Dashboard must reuse the current top-level continuity source that preserves Recruiting");
expect(dashboardPath, dashboard, /recruiting:\s*number/, "Dashboard summary must carry aggregate Recruiting attention only");
reject(dashboardPath, dashboard, /candidateName|annualBase|requisitionTitle|\.items/, "Dashboard must not receive Recruiting record detail");

const analyticsPath = "lib/lifecycle-analytics-continuity.ts";
const analytics = await source(analyticsPath);
expect(analyticsPath, analytics, /getWorkflowDefinitionLifecycleActionCenterData/, "Analytics must reuse the current top-level continuity source that preserves Recruiting");
expect(analyticsPath, analytics, /recruiting:\s*source\.summary\.recruiting/, "Analytics must project the Recruiting aggregate only");
expect(analyticsPath, analytics, /aggregateOnly:\s*true/, "Analytics privacy contract must remain aggregate-only");
reject(analyticsPath, analytics, /candidateName|annualBase|requisitionTitle|\.items/, "Analytics must not project Recruiting record detail");

const analyticsPagePath = "components/analytics-module-page.tsx";
const analyticsPage = await source(analyticsPagePath);
expect(analyticsPagePath, analyticsPage, /continuity\.summary\.recruiting/, "Analytics UI must surface only the aggregate Recruiting approval count");
expect(analyticsPagePath, analyticsPage, /\/module\/workflows\?view=recruiting/, "Analytics must deep-link Recruiting attention to the governed Action Center filter");
reject(analyticsPagePath, analyticsPage, /recruitingAnnualBase|candidateEmail|bankAccount/, "Analytics UI must not render sensitive Recruiting/offer detail");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /recruiting-action-center:validate/, "Recruiting continuity validation must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*recruiting-action-center:validate/, "Recruiting continuity validation must run before production builds");

if (failures.length) {
  console.error("Recruiting action center validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Recruiting action center validation passed.");
