import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const routePath = "app/api/action-center/history/route.ts";
const route = await source(routePath);
expect(routePath, route, /actorId:\s*ctx\.actorId/, "decision history must be actor scoped");
expect(routePath, route, /tenantId:\s*ctx\.tenantId/, "decision history must remain tenant scoped");
expect(routePath, route, /occurredAt:\s*\{\s*gte:\s*since\s*\}/, "decision history must be time bounded");
expect(routePath, route, /take:\s*80/, "decision history must be record bounded");
expect(routePath, route, /cache-control[\s\S]*no-store/, "decision history must be uncached");
expect(routePath, route, /actionPrefixes\.map/, "decision history must use an explicit governed action allowlist");
expect(routePath, route, /resourceTypes = new Set/, "decision history domain filtering must use an explicit resource-type allowlist");
expect(routePath, route, /resourceType && resourceTypes\.has\(resourceType\)/, "decision history must ignore unknown domain filters");
expect(routePath, route, /\.\.\.\(resourceType \? \{ resourceType \} : \{\}\)/, "decision history filter must remain inside the actor/tenant audit query");
expect(routePath, route, /"hr-service\."/ , "decision history must include governed HR Service lifecycle actions");
expect(routePath, route, /"ONBOARDING_TASK_"/, "decision history must include governed onboarding task decisions");
expect(routePath, route, /"benefit-enrollment\.transition\."/ , "decision history must include governed benefit enrollment decisions");
expect(routePath, route, /"learning-assignment\.self-transition\."/ , "decision history must include governed participant learning decisions");
expect(routePath, route, /"performance-review\.self-started"/, "decision history must include governed performance self-review starts");
expect(routePath, route, /"ONBOARDING_HANDOFF_"/, "decision history must include governed onboarding activation handoffs");
expect(routePath, route, /"offboarding\.task-"/, "decision history must include governed offboarding task decisions");
expect(routePath, route, /"employee-case\.corrective-action-"/, "decision history must include governed Employee Relations corrective-action starts");
expect(routePath, route, /"development-plan\.transition\."/ , "decision history must include governed development-plan lifecycle decisions");
expect(routePath, route, /classification:\s*true/, "decision history may expose classification metadata");
reject(routePath, route, /purpose:\s*true|ipAddress:\s*true|hash:\s*true|previousHash:\s*true/, "decision history must not project purpose, network or chain internals");
reject(routePath, route, /person:\s*true|employment:\s*true|annualBase:\s*true|payload:\s*true|workEmail:\s*true/, "decision history API must not project person, employment, pay or payload detail");


const exportPath = "app/api/action-center/history/export/route.ts";
const exported = await source(exportPath);
expect(exportPath, exported, /actorId:\s*ctx\.actorId/, "decision evidence export must be actor scoped");
expect(exportPath, exported, /tenantId:\s*ctx\.tenantId/, "decision evidence export must remain tenant scoped");
expect(exportPath, exported, /take:\s*500/, "decision evidence export must remain record bounded");
expect(exportPath, exported, /text\/csv/, "decision evidence export must return CSV");
expect(exportPath, exported, /content-disposition/, "decision evidence export must provide a download filename");
expect(exportPath, exported, /classification:\s*true/, "decision evidence export may include classification metadata");
expect(exportPath, exported, /resourceTypes = new Set/, "decision evidence export must use the same bounded domain allowlist");
expect(exportPath, exported, /\.\.\.\(resourceType \? \{ resourceType \} : \{\}\)/, "decision evidence export must apply the selected domain inside the governed query");
expect(exportPath, exported, /"hr-service\."/ , "decision evidence export must include governed HR Service lifecycle actions");
expect(exportPath, exported, /"ONBOARDING_TASK_"/, "decision evidence export must include governed onboarding task decisions");
expect(exportPath, exported, /"benefit-enrollment\.transition\."/ , "decision evidence export must include governed benefit enrollment decisions");
expect(exportPath, exported, /"learning-assignment\.self-transition\."/ , "decision evidence export must include governed participant learning decisions");
expect(exportPath, exported, /"performance-review\.self-started"/, "decision evidence export must include governed performance self-review starts");
expect(exportPath, exported, /"ONBOARDING_HANDOFF_"/, "decision evidence export must include governed onboarding activation handoffs");
expect(exportPath, exported, /"offboarding\.task-"/, "decision evidence export must include governed offboarding task decisions");
expect(exportPath, exported, /"employee-case\.corrective-action-"/, "decision evidence export must include governed Employee Relations corrective-action starts");
expect(exportPath, exported, /"development-plan\.transition\."/ , "decision evidence export must include governed development-plan lifecycle decisions");
reject(exportPath, exported, /purpose:\s*true|ipAddress:\s*true|hash:\s*true|previousHash:\s*true|payload:\s*true/, "decision evidence export must not include sensitive audit internals");

const componentPath = "components/action-center-decision-history.tsx";
const component = await source(componentPath);
expect(componentPath, component, /\/api\/action-center\/history\?\$\{params\.toString\(\)\}/, "decision history UI must consume the governed history route");
expect(componentPath, component, /7d[\s\S]*30d[\s\S]*90d/, "decision history must offer bounded time windows");
expect(componentPath, component, /actor-scoped|Actor scope/, "decision history must disclose actor scoping");
expect(componentPath, component, /Full hash-chained evidence remains in the Audit Ledger|Tam hash-zincirli kanıt Audit Ledger içinde kalır/, "decision history must direct full evidence to Audit Ledger");
expect(componentPath, component, /hrbp:lifecycle-actions-changed/, "decision history must refresh after lifecycle decisions");
expect(componentPath, component, /\/api\/action-center\/history\/export\?days=/, "decision history UI must expose actor-scoped CSV evidence export");
expect(componentPath, component, /Domain filter|Alan filtresi/, "decision history UI must expose an explicit domain filter");
expect(componentPath, component, /params\.set\("resourceType", selectedResourceType\)/, "decision history UI must send the selected domain to the governed history route");
expect(componentPath, component, /resourceType=\$\{encodeURIComponent\(resourceType\)\}/, "CSV export must preserve the active domain filter");
expect(componentPath, component, /PrivacyRiskAssessment/, "decision history must label privacy-assessment evidence");
expect(componentPath, component, /HRServiceRequest/, "decision history must label HR Service evidence");
expect(componentPath, component, /OnboardingTask/, "decision history must label onboarding task evidence");
expect(componentPath, component, /BenefitEnrollment/, "decision history must label benefit enrollment evidence");
expect(componentPath, component, /LearningAssignment/, "decision history must label participant learning evidence");
expect(componentPath, component, /PerformanceReview/, "decision history must label performance self-review evidence");
expect(componentPath, component, /OnboardingPlan/, "decision history must label onboarding handoff evidence");
expect(componentPath, component, /SeparationTask/, "decision history must label offboarding task evidence");
expect(componentPath, component, /CaseAction/, "decision history must label Employee Relations corrective-action evidence");
expect(componentPath, component, /DevelopmentPlan/, "decision history must label development-plan evidence");
reject(componentPath, component, /item\.purpose|item\.ipAddress|item\.previousHash|item\.hash\b/, "decision history UI must not render sensitive audit internals");

const modulePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /ActionCenterDecisionHistory/, "Workflows workspace must mount actor decision history with the Action Center");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /action-center-history:validate/, "action-center history validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*action-center-history:validate/, "action-center history validation must run before production builds");

if (failures.length) {
  console.error("Action Center history validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Action Center history validation passed.");
