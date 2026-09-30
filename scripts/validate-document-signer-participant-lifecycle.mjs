import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const routePath = "app/api/documents/[id]/signatures/[envelopeId]/participants/[participantId]/route.ts";
const route = await source(routePath);
expect(routePath, route, /mutationOriginAllowed\(request\)/, "participant decision must require same-origin mutation protection");
expect(routePath, route, /can\(ctx,\s*"documents:read"\)/, "participant decision must remain behind document read authority");
expect(routePath, route, /ctx\.employmentId/, "participant decision must require signed employment identity");
expect(routePath, route, /employmentId:\s*ctx\.employmentId/, "participant mutation must bind the participant to the signed employment identity");
expect(routePath, route, /SignatureParticipantStatus\.PENDING[\s\S]*SignatureParticipantStatus\.VIEWED/, "only pending/viewed participants may act");
expect(routePath, route, /SignatureEnvelopeStatus\.SENT[\s\S]*SignatureEnvelopeStatus\.IN_PROGRESS/, "only active envelopes may accept participant decisions");
expect(routePath, route, /entry\.signingOrder\s*<\s*participant\.signingOrder[\s\S]*SignatureParticipantStatus\.SIGNED/, "earlier signing order must be complete before action");
expect(routePath, route, /VaultScanStatus\.CLEAN/, "participant action must stay pinned to a CLEAN immutable document version");
expect(routePath, route, /Prisma\.TransactionIsolationLevel\.Serializable/, "participant transition must be serializable");
expect(routePath, route, /updateMany\(/, "participant transition must use optimistic state-aware mutation");
expect(routePath, route, /participant\.signed/, "signed decision must create immutable event evidence");
expect(routePath, route, /participant\.declined/, "declined decision must create immutable event evidence");
expect(routePath, route, /appendAudit\(/, "participant decision must be audited");
expect(routePath, route, /SignatureEnvelopeStatus\.VOIDED/, "human decline must void the envelope");
expect(routePath, route, /SignatureEnvelopeStatus\.COMPLETED/, "all signed participants must complete the envelope");
reject(routePath, route, /status:\s*SignatureEnvelopeStatus\.EXPIRED/, "participant decision must not silently auto-expire the envelope");

const dataPath = "lib/document-signer-participant-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /employmentId:\s*ctx\.employmentId/, "signer workspace must resolve only the signed employment participant");
expect(dataPath, data, /documentVisibilityWhere\(db,\s*ctx\)/, "signer workspace must reuse governed generic document visibility");
expect(dataPath, data, /entry\.signingOrder\s*<\s*participant\.signingOrder/, "workspace actionability must enforce signing order");
expect(dataPath, data, /VaultScanStatus\.CLEAN/, "workspace must require the immutable version to remain CLEAN");
reject(dataPath, data, /findUnique\(/, "exact participant focus must not use an unscoped primary-key lookup");

const consolePath = "components/document-signer-participant-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /decision:\s*"SIGNED"\s*\|\s*"DECLINED"/, "UI must expose only explicit sign/decline decisions");
expect(consolePath, consoleSource, /hrbp:lifecycle-actions-changed/, "successful signer decisions must refresh lifecycle attention");
expect(consolePath, consoleSource, /Human document signature participant decision/, "participant mutation must declare an explicit purpose");

const pagePath = "app/module/documents/sign/[participantId]/page.tsx";
const page = await source(pagePath);
expect(pagePath, page, /getDocumentSignerParticipantData\(ctx,\s*participantId\)/, "exact signer route must resolve the signed participant workspace");
expect(pagePath, page, /No broader participant lookup was attempted/, "out-of-scope signer focus must fail closed");

const actionPath = "lib/document-signature-action-continuity.ts";
const action = await source(actionPath);
expect(actionPath, action, /employmentId:\s*ctx\.employmentId/, "Action Center signer attention must bind to signed employment identity");
expect(actionPath, action, /SignatureParticipantStatus\.PENDING[\s\S]*SignatureParticipantStatus\.VIEWED/, "Action Center must include only actionable participant states");
expect(actionPath, action, /SignatureEnvelopeStatus\.SENT[\s\S]*SignatureEnvelopeStatus\.IN_PROGRESS/, "Action Center must include only active envelopes");
expect(actionPath, action, /entry\.signingOrder\s*<\s*participant\.signingOrder/, "Action Center must suppress participants blocked by earlier signers");
expect(actionPath, action, /documentVisibilityWhere\(db,\s*ctx\)/, "Action Center must recheck governed document visibility");
expect(actionPath, action, /take:\s*100/, "participant aggregation must remain bounded");
expect(actionPath, action, /href:\s*`\/module\/documents\/sign\/\$\{encodeURIComponent\(participant\.id\)\}`/, "participant attention must deep-link to the exact signer workspace");
expect(actionPath, action, /subjectType:\s*"SignatureParticipant"/, "shared attention must preserve participant subject identity");
reject(actionPath, action, /email:\s*true|contentHash:\s*true|objectKey:\s*true|scanMessage:\s*true/, "Action Center signer aggregation must not project signer emails or sensitive document evidence");

const packagePath = "package.json";
const packageSource = await source(packagePath);
expect(packagePath, packageSource, /document-signer-participant:validate/, "dedicated signer validator must be wired into scripts/prebuild");

if (failures.length) {
  console.error("Document signer participant lifecycle validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Document signer participant lifecycle validation passed.");
