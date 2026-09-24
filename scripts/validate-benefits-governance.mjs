import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const modulePath = "components/growth-module-page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /BenefitsGovernanceConsole/, "benefits writers must receive the effective-dated plan governance console");
expect(modulePath, modulePage, /getBenefitsGovernanceData\(ctx\)/, "benefit plan governance data must load from signed request context");

const planCreatePath = "app/api/benefits/plans/route.ts";
const planCreate = await source(planCreatePath);
expect(planCreatePath, planCreate, /effectiveTo cannot be earlier than effectiveFrom/, "benefit plan creation must reject inverted effective dates");
expect(planCreatePath, planCreate, /Contributions must be non-negative amounts or blank/, "benefit plan contributions must be bounded to non-negative values");
expect(planCreatePath, planCreate, /countryCode must be a two-letter code or blank/, "benefit plan country codes must be normalized and validated");
expect(planCreatePath, planCreate, /currency must be a three-letter code or blank/, "benefit plan currency codes must be normalized and validated");

const enrollmentCreatePath = "app/api/benefits/enrollments/route.ts";
const enrollmentCreate = await source(enrollmentCreatePath);
expect(enrollmentCreatePath, enrollmentCreate, /status:\s*BenefitEnrollmentStatus\.PENDING/, "new benefit elections must always enter the governed pending state");
expect(enrollmentCreatePath, enrollmentCreate, /OUTSIDE_PLAN_PERIOD/, "new benefit elections must stay within the plan effective period");
expect(enrollmentCreatePath, enrollmentCreate, /benefit-enrollment\.created-pending/, "new benefit elections must emit explicit pending-state audit evidence");
expect(enrollmentCreatePath, enrollmentCreate, /canActOnEmployment/, "benefit election creation must enforce relationship scope");

const enrollmentUpdatePath = "app/api/benefits/enrollments/[id]/route.ts";
const enrollmentUpdate = await source(enrollmentUpdatePath);
expect(enrollmentUpdatePath, enrollmentUpdate, /can\(ctx,\s*"benefits:write"\)/, "pending benefit election amendments must require benefits:write");
expect(enrollmentUpdatePath, enrollmentUpdate, /enrollment\.status\s*!==\s*BenefitEnrollmentStatus\.PENDING/, "only pending benefit elections may be amended");
expect(enrollmentUpdatePath, enrollmentUpdate, /canActOnEmployment/, "pending benefit election amendments must remain relationship scoped");
expect(enrollmentUpdatePath, enrollmentUpdate, /PLAN_INACTIVE/, "pending elections on inactive plans must be locked");
expect(enrollmentUpdatePath, enrollmentUpdate, /OUTSIDE_PLAN_PERIOD/, "pending election amendments must preserve plan effective-date boundaries");
expect(enrollmentUpdatePath, enrollmentUpdate, /updateMany/, "pending election amendments must use state-aware writes");
expect(enrollmentUpdatePath, enrollmentUpdate, /benefit-enrollment\.pending-amended/, "pending election amendments must emit explicit audit evidence");

const planUpdatePath = "app/api/benefits/plans/[id]/route.ts";
const planUpdate = await source(planUpdatePath);
expect(planUpdatePath, planUpdate, /can\(ctx,\s*"benefits:write"\)/, "benefit plan lifecycle maintenance must require benefits:write");
expect(planUpdatePath, planUpdate, /benefit-plan\.deactivated/, "benefit plan lifecycle must support auditable deactivation");
expect(planUpdatePath, planUpdate, /benefit-plan\.reactivated/, "benefit plan lifecycle must support auditable reactivation");
expect(planUpdatePath, planUpdate, /effectiveTo cannot be earlier than effectiveFrom/, "benefit plan lifecycle must protect effective-date ordering");
expect(planUpdatePath, planUpdate, /ENROLLMENT_DATE_CONFLICT/, "benefit plan end dates must not invalidate open enrollment periods");
expect(planUpdatePath, planUpdate, /PLAN_EXPIRED/, "expired benefit plans must not be reactivated without extending their end date");
expect(planUpdatePath, planUpdate, /BenefitEnrollmentStatus\.PENDING[\s\S]*BenefitEnrollmentStatus\.ACTIVE[\s\S]*BenefitEnrollmentStatus\.SUSPENDED/, "benefit plan date conflict checks must cover all open election states");

const transitionPath = "app/api/benefits/enrollments/[id]/transition/route.ts";
const transition = await source(transitionPath);
expect(transitionPath, transition, /benefitPlan:\s*\{\s*select:\s*\{\s*active:\s*true/, "benefit activation must load governing plan lifecycle state");
expect(transitionPath, transition, /PLAN_INACTIVE/, "inactive benefit plans must reject coverage activation");
expect(transitionPath, transition, /OUTSIDE_PLAN_PERIOD/, "benefit lifecycle transitions must preserve plan effective-date boundaries");
expect(transitionPath, transition, /updateMany/, "benefit lifecycle transitions must use state-aware writes");
expect(transitionPath, transition, /STALE_STATE/, "benefit lifecycle transitions must detect concurrent state changes");

const lifecycleDataPath = "lib/growth-lifecycle-data.ts";
const lifecycleData = await source(lifecycleDataPath);
expect(lifecycleDataPath, lifecycleData, /employerContribution:\s*true/, "benefit lifecycle data must expose election employer contribution");
expect(lifecycleDataPath, lifecycleData, /employeeContribution:\s*true/, "benefit lifecycle data must expose election employee contribution");
expect(lifecycleDataPath, lifecycleData, /benefitPlan:\s*\{\s*select:\s*\{[^}]*effectiveFrom:\s*true[^}]*effectiveTo:\s*true/, "benefit lifecycle data must expose governing plan date bounds");

const lifecycleConsolePath = "components/growth-lifecycle-console.tsx";
const lifecycleConsole = await source(lifecycleConsolePath);
expect(lifecycleConsolePath, lifecycleConsole, /\/api\/benefits\/enrollments\/\$\{row\.id\}/, "pending benefit election console must use the governed amendment endpoint");
expect(lifecycleConsolePath, lifecycleConsole, /"PATCH"/, "pending benefit election console must use explicit patch mutations");
expect(lifecycleConsolePath, lifecycleConsole, /row\.status\s*===\s*"PENDING"/, "pending amendment controls must be hidden after election leaves pending state");
expect(lifecycleConsolePath, lifecycleConsole, /Save pending election|Bekleyen seçimi kaydet/, "benefit lifecycle console must expose pending election amendment action");

const dataPath = "lib/benefits-governance-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /resolveEmploymentScope/, "benefit governance reads must resolve relationship scope");
expect(dataPath, data, /employmentIdFilter\(scope\)/, "benefit governance counts must remain relationship scoped");
expect(dataPath, data, /BenefitEnrollmentStatus\.ACTIVE/, "benefit governance must expose active coverage counts");
expect(dataPath, data, /BenefitEnrollmentStatus\.PENDING/, "benefit governance must expose pending election counts");

const consolePath = "components/benefits-governance-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /\/api\/benefits\/plans\/\$\{id\}/, "benefit governance console must use the governed plan endpoint");
expect(consolePath, consoleSource, /method:\s*"PATCH"/, "benefit governance console must use explicit patch mutations");
expect(consolePath, consoleSource, /Deactivate|Pasife al/, "benefit plan governance must expose non-destructive deactivation");
expect(consolePath, consoleSource, /employerContribution/, "benefit plan governance must maintain employer contribution metadata");
expect(consolePath, consoleSource, /employeeContribution/, "benefit plan governance must maintain employee contribution metadata");

const maintenancePath = "lib/benefits-maintenance.ts";
const maintenance = await source(maintenancePath);
expect(maintenancePath, maintenance, /HRBP_BENEFITS_EXPIRY_BATCH_SIZE/, "benefit expiry maintenance must be runtime bounded");
expect(maintenancePath, maintenance, /effectiveTo:\s*\{\s*not:\s*null,\s*lte:\s*now\s*\}/, "benefit expiry maintenance must only process expired active plans");
expect(maintenancePath, maintenance, /benefit-plan\.expired/, "expired benefit plans must emit audit evidence");
expect(maintenancePath, maintenance, /benefit-enrollment\.ended-on-plan-expiry/, "open enrollments ended by plan expiry must emit audit evidence");
expect(maintenancePath, maintenance, /BENEFIT_PLAN_EXPIRED/, "expired benefit plans must generate an operational notification");
expect(maintenancePath, maintenance, /recipientRole:\s*PlatformRole\.HR_OPERATIONS/, "benefit expiry notifications must route to an operational owner role");
expect(maintenancePath, maintenance, /anomalousEnrollments/, "legacy date anomalies must be surfaced instead of silently rewritten");

const internalMaintenancePath = "app/api/internal/maintenance/route.ts";
const internalMaintenance = await source(internalMaintenancePath);
expect(internalMaintenancePath, internalMaintenance, /runBenefitsMaintenance/, "internal maintenance must execute benefit lifecycle normalization");
expect(internalMaintenancePath, internalMaintenance, /benefitsLifecycle/, "maintenance response must expose benefit lifecycle results");

const presentationPath = "lib/notification-presentation.ts";
const presentation = await source(presentationPath);
expect(presentationPath, presentation, /BENEFIT_PLAN_EXPIRED/, "notification center must present benefit plan expiry events");
expect(presentationPath, presentation, /resourceType\s*===\s*"BenefitPlan"/, "benefit plan notifications must deep-link to benefits workspace");
expect(presentationPath, presentation, /anomalousEnrollments/, "benefit plan expiry summaries must surface anomaly counts");

const envPath = ".env.example";
const env = await source(envPath);
expect(envPath, env, /HRBP_BENEFITS_EXPIRY_BATCH_SIZE=/, "benefit expiry maintenance batch size must be documented");

if (failures.length) {
  console.error("Benefits governance contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated benefits governance contract: pending-only election creation and amendments, relationship scope, effective-date integrity, open-enrollment conflict protection, state-aware transitions, non-destructive plan lifecycle and automated expiry evidence are enforced.");
