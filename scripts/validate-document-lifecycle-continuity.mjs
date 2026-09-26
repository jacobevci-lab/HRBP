import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const accessPath = "lib/document-access.ts";
const access = await source(accessPath);
expect(accessPath, access, /tenantId:\s*ctx\.tenantId/, "document visibility must remain tenant scoped");
expect(accessPath, access, /caseId:\s*null/, "generic document vault must continue excluding Employee Relations case evidence");
expect(accessPath, access, /classification:\s*\{\s*not:\s*DataClassification\.HIGHLY_RESTRICTED/, "classification filtering must remain explicit for actors without highly restricted access");

const projectionPath = "lib/document-public-projection.ts";
const projection = await source(projectionPath);
expect(projectionPath, projection, /publicDocument/, "document API must use an explicit browser-safe projection");
expect(projectionPath, projection, /publicDocumentVersion/, "document-version API must use an explicit browser-safe projection");
reject(projectionPath, projection, /return\s*\{[^}]*objectKey/s, "public projections must never return private object storage keys");

const documentsRoutePath = "app/api/documents/route.ts";
const documentsRoute = await source(documentsRoutePath);
expect(documentsRoutePath, documentsRoute, /documentVisibilityWhere\(db,\s*ctx\)/, "document list must derive from governed visibility scope");
expect(documentsRoutePath, documentsRoute, /rows\.map\(publicDocument\)/, "document list must redact server-side storage capabilities");
expect(documentsRoutePath, documentsRoute, /data:\s*publicDocument\(data\)/, "document creation response must redact server-side storage capabilities");

const versionRoutePath = "app/api/documents/[id]/versions/route.ts";
const versions = await source(versionRoutePath);
expect(versionRoutePath, versions, /getVisibleDocument\(db,\s*ctx,\s*id\)/, "version reads must recheck governed document visibility");
expect(versionRoutePath, versions, /rows\.map\(publicDocumentVersion\)/, "version list must redact private object keys");
expect(versionRoutePath, versions, /data:\s*publicDocumentVersion\(result\)/, "version reservation response must redact private object keys");

const governancePath = "app/api/documents/[id]/governance/route.ts";
const governance = await source(governancePath);
expect(governancePath, governance, /getVisibleDocument\(tx,\s*ctx,\s*id\)/, "governance mutations must remain scoped to a visible document");
expect(governancePath, governance, /data:\s*publicDocument\(result\)/, "governance mutation responses must redact private object keys");
expect(governancePath, governance, /PlatformRole\.LEGAL/, "legal hold changes must remain restricted to Legal");

const deletePath = "app/api/documents/[id]/route.ts";
const deletion = await source(deletePath);
expect(deletePath, deletion, /select:\s*\{\s*id:\s*true,\s*status:\s*true\s*\}/, "logical deletion response must expose only minimal state");
expect(deletePath, deletion, /document\.legalHold/, "legal hold must continue blocking deletion");
expect(deletePath, deletion, /document\.retentionUntil/, "retention must continue blocking premature deletion");

const livePath = "lib/governance-live-data.ts";
const live = await source(livePath);
expect(livePath, live, /query\.trim\(\)\.slice\(0,\s*160\)/, "document lifecycle lookup input must be bounded");
expect(livePath, live, /\{\s*id:\s*normalized\s*\}/, "exact document deep links must resolve by document id");
expect(livePath, live, /\{\s*personId:\s*normalized\s*\}/, "person lifecycle links must resolve the visible employee document set");
expect(livePath, live, /AND:\s*\[baseWhere,\s*searchWhere\]/, "all lifecycle/deep-link searches must intersect the existing governed document scope");
reject(livePath, live, /objectKey/, "document workspace data must never project private object-store keys");

const modulePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /search\.document/, "Documents routing must accept an exact document focus parameter");
expect(modulePath, modulePage, /slug\s*===\s*"documents"[\s\S]*documentFocus\s*\|\|\s*personId/, "Documents routing must converge document and person lifecycle links into the governed vault search path");

const notificationPath = "lib/notification-display.ts";
const notifications = await source(notificationPath);
expect(notificationPath, notifications, /resourceType\s*===\s*"DocumentRecord"[\s\S]*\/module\/documents\?document=/, "document notifications must deep-link into the governed vault");

const uploadPath = "app/api/documents/[id]/versions/[versionId]/upload/route.ts";
const upload = await source(uploadPath);
expect(uploadPath, upload, /VaultScanStatus\.PENDING/, "new uploads must remain malware-gated until scan completion");
expect(uploadPath, upload, /putPrivateObject\(authorization\.version\.objectKey/, "object keys may only be consumed on the server-side storage boundary");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /document-lifecycle:validate/, "document lifecycle validator must be wired into package scripts");
expect(packagePath, pkg, /prebuild[\s\S]*document-lifecycle:validate/, "document lifecycle validation must run before production builds");

if (failures.length) {
  console.error("Document lifecycle continuity validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Document lifecycle continuity validation passed.");
