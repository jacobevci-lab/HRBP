import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function expectAbsent(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const readinessPath = "lib/offboarding-readiness.ts";
const readiness = await source(readinessPath);
expect(readinessPath, readiness, /terminalAssetReturnStatuses[\s\S]*RETURNED[\s\S]*WRITTEN_OFF/, "asset terminal states must be centralized");
expect(readinessPath, readiness, /terminalAccessRevocationStatuses[\s\S]*REVOKED[\s\S]*EXCEPTION/, "access terminal states must be centralized");
expect(readinessPath, readiness, /FINAL_PAY_REVIEW[\s\S]*READY_TO_CLOSE/, "readiness helper must preserve payroll review and close-ready states");
expect(readinessPath, readiness, /separationProcess\.updateMany\([\s\S]*status:\s*process\.status/, "readiness process transition must be state-aware");
expect(readinessPath, readiness, /appendAudit/, "readiness-derived process transitions must be audited");

const assetCreatePath = "app/api/offboarding/processes/[id]/assets/route.ts";
const assetCreate = await source(assetCreatePath);
expect(assetCreatePath, assetCreate, /asText\(body\.assetTag,\s*100\)/, "asset tag must be bounded");
expect(assetCreatePath, assetCreate, /asText\(body\.assetType,\s*120\)/, "asset type must be bounded");
expect(assetCreatePath, assetCreate, /recalculateSeparationReadiness/, "registering an asset must reopen/recalculate the exit gate");
expect(assetCreatePath, assetCreate, /TransactionIsolationLevel\.Serializable/, "asset registration must use serializable isolation");
expect(assetCreatePath, assetCreate, /P2002/, "duplicate asset tags must return a controlled conflict");

const assetStatusPath = "app/api/offboarding/processes/[id]/assets/[assetId]/status/route.ts";
const assetStatus = await source(assetStatusPath);
expect(assetStatusPath, assetStatus, /DAMAGED[\s\S]*LOST[\s\S]*WRITTEN_OFF/, "asset exception states must be explicit");
expect(assetStatusPath, assetStatus, /requiresReason/, "asset exception transitions must require evidence");
expect(assetStatusPath, assetStatus, /assetReturn\.updateMany\([\s\S]*status:\s*asset\.status/, "asset transitions must be state-aware");
expect(assetStatusPath, assetStatus, /verifiedById:\s*terminal\s*\?\s*ctx\.actorId/, "terminal asset custody must record human verifier");
expect(assetStatusPath, assetStatus, /recalculateSeparationReadiness/, "asset transitions must recalculate separation readiness");
expect(assetStatusPath, assetStatus, /TransactionIsolationLevel\.Serializable/, "asset transitions must use serializable isolation");

const accessCreatePath = "app/api/offboarding/processes/[id]/access/route.ts";
const accessCreate = await source(accessCreatePath);
expect(accessCreatePath, accessCreate, /asText\(body\.systemName,\s*160\)/, "access system name must be bounded");
expect(accessCreatePath, accessCreate, /accessRevocation\.findFirst/, "access registration must explicitly catch nullable-account duplicates");
expect(accessCreatePath, accessCreate, /recalculateSeparationReadiness/, "registering access must reopen/recalculate the exit gate");
expect(accessCreatePath, accessCreate, /TransactionIsolationLevel\.Serializable/, "access registration must use serializable isolation");

const accessStatusPath = "app/api/offboarding/processes/[id]/access/[accessId]/status/route.ts";
const accessStatus = await source(accessStatusPath);
expect(accessStatusPath, accessStatus, /SCHEDULED[\s\S]*REVOKED[\s\S]*EXCEPTION/, "access lifecycle must be explicit");
expect(accessStatusPath, accessStatus, /EXCEPTION[\s\S]*exceptionReason/, "access exceptions must require explicit reason");
expect(accessStatusPath, accessStatus, /SCHEDULED[\s\S]*scheduledAt/, "scheduled revocation must require a timestamp");
expect(accessStatusPath, accessStatus, /accessRevocation\.updateMany\([\s\S]*status:\s*access\.status/, "access transitions must be state-aware");
expect(accessStatusPath, accessStatus, /verifiedById:\s*terminal\s*\?\s*ctx\.actorId/, "terminal access controls must record human verifier");
expect(accessStatusPath, accessStatus, /recalculateSeparationReadiness/, "access transitions must recalculate separation readiness");
expect(accessStatusPath, accessStatus, /TransactionIsolationLevel\.Serializable/, "access transitions must use serializable isolation");

const taskPath = "app/api/offboarding/processes/[id]/tasks/[taskId]/complete/route.ts";
const task = await source(taskPath);
expect(taskPath, task, /recalculateSeparationReadiness/, "task lifecycle must use the same centralized readiness helper");
expectAbsent(taskPath, task, /assetReturn\.count/, "task route must not carry a duplicate readiness implementation");

const dataPath = "lib/offboarding-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /assets:[\s\S]*assetTag:[\s\S]*conditionNote:/, "live offboarding data must expose asset custody controls");
expect(dataPath, data, /accessControls:[\s\S]*systemName:[\s\S]*exceptionReason:/, "live offboarding data must expose access revocation controls");

const consolePath = "components/offboarding-clearance-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /\/assets\/\$\{id\}\/status|\/assets\/\$\{process\.id\}/, "clearance UI must call governed asset endpoints");
expect(consolePath, consoleSource, /\/access\/\$\{id\}\/status|\/access\/\$\{process\.id\}/, "clearance UI must call governed access endpoints");
expect(consolePath, consoleSource, /WRITTEN_OFF/, "clearance UI must expose explicit asset write-off flow");
expect(consolePath, consoleSource, /EXCEPTION/, "clearance UI must expose explicit access exception flow");
expect(consolePath, consoleSource, /datetime-local/, "clearance UI must capture scheduled revocation time");

const loaderPath = "components/offboarding-clearance-loader.tsx";
const loader = await source(loaderPath);
expect(loaderPath, loader, /can\(ctx,\s*"offboarding:write"\)/, "clearance mutation console must only load for offboarding writers");

const pagePath = "app/module/[slug]/page.tsx";
const page = await source(pagePath);
expect(pagePath, page, /slug === "offboarding"[\s\S]*OffboardingClearanceLoader/, "offboarding module must mount the custody/access clearance console");

if (failures.length) {
  console.error("Offboarding clearance validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Offboarding clearance validation passed.");
