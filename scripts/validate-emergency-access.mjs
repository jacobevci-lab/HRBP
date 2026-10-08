import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) {
  if (!pattern.test(text)) failures.push(path + ": " + message);
}

const schemaPath = "prisma/platform.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /enum EmergencyAccessStatus[\s\S]*REQUESTED[\s\S]*ACTIVE[\s\S]*REJECTED[\s\S]*REVOKED[\s\S]*EXPIRED/, "emergency access lifecycle statuses must remain explicit");
expect(schemaPath, schema, /model EmergencyAccessGrant[\s\S]*requestedMinutes\s+Int[\s\S]*validTo\s+DateTime\?/, "emergency access must persist bounded duration and expiry");

const migrationPath = "prisma/migrations/20261008143000_emergency_access/migration.sql";
const migration = await source(migrationPath);
expect(migrationPath, migration, /CHECK \("requestedMinutes" BETWEEN 15 AND 60\)/, "database must bound emergency access duration");
expect(migrationPath, migration, /FOREIGN KEY \("requesterId"\)[\s\S]*UserAccount/, "database must enforce requester identity integrity");

const helperPath = "lib/emergency-access.ts";
const helper = await source(helperPath);
expect(helperPath, helper, /role !== PlatformRole\.TENANT_ADMIN/, "only tenant administrators may resolve emergency access");
expect(helperPath, helper, /breakGlassEnabled:\s*true/, "runtime emergency access must honor tenant break-glass policy");
expect(helperPath, helper, /status:\s*EmergencyAccessStatus\.ACTIVE[\s\S]*validFrom:\s*\{ lte: now \}[\s\S]*validTo:\s*\{ gt: now \}/, "runtime access must require active unexpired grant");
expect(helperPath, helper, /catch[\s\S]*breakGlassActive:\s*false/, "emergency access lookup must fail closed");

const requestContextPath = "lib/request-context.ts";
const requestContext = await source(requestContextPath);
expect(requestContextPath, requestContext, /resolveEmergencyAccess[\s\S]*\.\.\.emergency/, "API request context must resolve break-glass dynamically on every verified request");
expect(requestContextPath, requestContext, /breakGlassGrantId\?: string[\s\S]*breakGlassExpiresAt\?: Date/, "request context must carry bounded grant identity and expiry");

const serverContextPath = "lib/server-session.ts";
const serverContext = await source(serverContextPath);
expect(serverContextPath, serverContext, /resolveEmergencyAccess[\s\S]*\.\.\.emergency/, "server-rendered views must use the same live emergency-access resolution");

const authorizationPath = "lib/authorization.ts";
const authorization = await source(authorizationPath);
expect(authorizationPath, authorization, /breakGlassReadCapabilities[\s\S]*"cases:read"[\s\S]*"privacy:read"/, "break-glass must add only the explicit case/privacy read capabilities");
expect(authorizationPath, authorization, /ctx\.breakGlassActive === true[\s\S]*ctx\.role === PlatformRole\.TENANT_ADMIN[\s\S]*breakGlassReadCapabilities\.has\(capability\)/, "break-glass capability expansion must be tenant-admin and active-grant bound");
expect(authorizationPath, authorization, /classification !== DataClassification\.HIGHLY_RESTRICTED[\s\S]*ctx\.breakGlassActive === true[\s\S]*ctx\.role === PlatformRole\.TENANT_ADMIN/, "break-glass must expand highly-restricted read classification checks only")

const caseWallPath = "lib/case-wall.ts";
const caseWall = await source(caseWallPath);
expect(caseWallPath, caseWall, /ctx\.breakGlassActive === true && ctx\.role === PlatformRole\.TENANT_ADMIN/, "case wall bypass must require active tenant-admin break-glass");
expect(caseWallPath, caseWall, /emergencyRead \? \{\} : \{[\s\S]*ownerUserId[\s\S]*assignments/, "ordinary case wall assignment scoping must remain intact outside break-glass");

const requestRoutePath = "app/api/settings/emergency-access/route.ts";
const requestRoute = await source(requestRoutePath);
expect(requestRoutePath, requestRoute, /ctx\.mfaSatisfied === true[\s\S]*ctx\.assuranceVersion === authenticationAssuranceVersion\(\)/, "emergency access requests/decisions must require current MFA assurance mapping");
expect(requestRoutePath, requestRoute, /reason\.length < 20/, "emergency access request must require substantive justification");
expect(requestRoutePath, requestRoute, /requestedMinutes < 15[\s\S]*requestedMinutes > 60/, "emergency access request duration must be bounded");
expect(requestRoutePath, requestRoute, /OPEN_REQUEST_EXISTS/, "requester must not accumulate overlapping emergency grants");
expect(requestRoutePath, requestRoute, /TransactionIsolationLevel\.Serializable/, "emergency access request creation must serialize concurrent open-request races");
expect(requestRoutePath, requestRoute, /security\.emergency-access-requested/, "request creation must be audited");

const decisionPath = "app/api/settings/emergency-access/[id]/decision/route.ts";
const decision = await source(decisionPath);
expect(decisionPath, decision, /grant\.requesterId === ctx\.actorId[\s\S]*FOUR_EYES_REQUIRED/, "requester must never decide their own emergency access");
expect(decisionPath, decision, /new Date\(now\.getTime\(\) \+ grant\.requestedMinutes \* 60_000\)/, "approval must derive expiry from the bounded requested duration");
expect(decisionPath, decision, /security\.emergency-access-approved[\s\S]*security\.emergency-access-rejected/, "approval/rejection must be audited distinctly");
expect(decisionPath, decision, /enqueueNotificationOutbox[\s\S]*EMERGENCY_ACCESS_APPROVED[\s\S]*EMERGENCY_ACCESS_REJECTED/, "requester must receive bounded decision notifications");

const revokePath = "app/api/settings/emergency-access/[id]/route.ts";
const revoke = await source(revokePath);
expect(revokePath, revoke, /REQUESTED[\s\S]*ACTIVE[\s\S]*REVOKED/, "only open emergency access states may be revoked");
expect(revokePath, revoke, /security\.emergency-access-revoked/, "revocation must be audited");
expect(revokePath, revoke, /enqueueNotificationOutbox[\s\S]*EMERGENCY_ACCESS_REVOKED/, "revocation must notify the requester");

const maintenancePath = "lib/operational-maintenance.ts";
const maintenance = await source(maintenancePath);
expect(maintenancePath, maintenance, /expireEmergencyAccess[\s\S]*EmergencyAccessStatus\.ACTIVE[\s\S]*validTo:\s*\{ lte: now \}/, "maintenance must expire elapsed emergency grants");
expect(maintenancePath, maintenance, /security\.emergency-access-expired/, "automatic expiry must write audit evidence");
expect(maintenancePath, maintenance, /EMERGENCY_ACCESS_EXPIRED/, "automatic expiry must notify the requester");

const componentPath = "components/emergency-access-admin.tsx";
const component = await source(componentPath);
expect(componentPath, component, /Four-eyes break-glass access|Dört göz kontrollü break-glass erişimi/, "settings must explain four-eyes emergency access");
expect(componentPath, component, /Request emergency access|Acil erişim talep et/, "settings must expose governed emergency access request");
expect(componentPath, component, /APPROVE[\s\S]*REJECT[\s\S]*Revoke|Geri al/, "settings must expose independent decision and revocation controls");

const settingsPath = "components/settings-live-page.tsx";
const settings = await source(settingsPath);
expect(settingsPath, settings, /<EmergencyAccessAdmin\/>/, "settings operations page must surface emergency access controls");

if (failures.length) {
  console.error("Emergency access validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Emergency access validation passed.");
