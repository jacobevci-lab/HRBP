import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const requisitionPath = "app/api/recruiting/requisitions/[id]/status/route.ts";
const requisition = await source(requisitionPath);
expect(requisitionPath, requisition, /current\.openings\s*!==\s*1/, "position-backed requisitions must represent exactly one authorized headcount position");
expect(requisitionPath, requisition, /position\.status\s*!==\s*PositionStatus\.OPEN/, "requisition opening must verify that the linked position is still open");
expect(requisitionPath, requisition, /status:\s*\{\s*in:\s*\[RequisitionStatus\.OPEN,\s*RequisitionStatus\.ON_HOLD\]\s*\}/, "a position must not be owned by another active requisition");
expect(requisitionPath, requisition, /TransactionIsolationLevel\.Serializable/, "requisition activation must remain serializable");

const candidatePath = "app/api/recruiting/candidates/route.ts";
const candidate = await source(candidatePath);
expect(candidatePath, candidate, /readJsonObject\(request\)/, "candidate creation must reject malformed or non-object JSON bodies");
expect(candidatePath, candidate, /asText\(body\.givenName,\s*120\)[\s\S]*asText\(body\.familyName,\s*120\)[\s\S]*asText\(body\.email,\s*254\)/, "candidate direct identifiers must have explicit length bounds");
expect(candidatePath, candidate, /asIdentifier\(body\.requisitionId\)/, "candidate requisition references must use identifier validation");
expect(candidatePath, candidate, /retentionUntil\s*&&\s*retentionUntil\s*<=\s*new Date\(\)/, "candidate retention deadlines must be future-dated at collection time");
expect(candidatePath, candidate, /requisition\.status\s*!==\s*RequisitionStatus\.OPEN/, "candidate applications must only attach to open requisitions");
expect(candidatePath, candidate, /TransactionIsolationLevel\.Serializable/, "candidate reuse and application creation must be serialized");
expect(candidatePath, candidate, /error\.code\s*===\s*"P2002"[\s\S]*error\.code\s*===\s*"P2034"/, "candidate duplicate and serialization races must return controlled conflicts");

const offerCreatePath = "app/api/recruiting/applications/[id]/offer/route.ts";
const offerCreate = await source(offerCreatePath);
expect(offerCreatePath, offerCreate, /readJsonObject\(request\)/, "offer preparation must use bounded JSON-object input parsing");
expect(offerCreatePath, offerCreate, /OFFER_CREATION_STAGES[\s\S]*ApplicationStage\.INTERVIEW[\s\S]*ApplicationStage\.ASSESSMENT[\s\S]*ApplicationStage\.OFFER/, "offer preparation must be restricted to offer-eligible application stages");
expect(offerCreatePath, offerCreate, /application\.requisition\.status\s*!==\s*RequisitionStatus\.OPEN/, "offer drafts must only be prepared for open requisitions");
expect(offerCreatePath, offerCreate, /!application\.requisition\.positionId/, "offer preparation must require an authorized position");
expect(offerCreatePath, offerCreate, /expiresAt\s*&&\s*expiresAt\s*<=\s*now/, "new offers must reject already-expired deadlines");
expect(offerCreatePath, offerCreate, /expiresAt\s*&&\s*expiresAt\s*>=\s*startDate/, "offer response deadlines must precede the proposed employment start date");
expect(offerCreatePath, offerCreate, /tx\.application\.updateMany[\s\S]*stage:\s*application\.stage[\s\S]*updated\.count\s*!==\s*1/, "offer preparation must synchronize application state with an optimistic guard");
expect(offerCreatePath, offerCreate, /TransactionIsolationLevel\.Serializable/, "offer preparation must use serializable transaction isolation");
expect(offerCreatePath, offerCreate, /error\.code\s*===\s*"P2034"[\s\S]*error\.code\s*===\s*"P2002"/, "offer creation concurrency and uniqueness conflicts must fail safely");

const applicationPath = "app/api/recruiting/applications/[id]/stage/route.ts";
const application = await source(applicationPath);
expect(applicationPath, application, /ACTIVE_OFFER_STATUSES[\s\S]*OfferStatus\.APPROVAL[\s\S]*OfferStatus\.SENT[\s\S]*OfferStatus\.ACCEPTED/, "active offer states must lock manual application drift");
expect(applicationPath, application, /ACTIVE_OFFER_STATUSES\.has\(current\.offer\.status\)[\s\S]*next\s*!==\s*ApplicationStage\.OFFER/, "application must stay in offer stage while an active offer exists");
expect(applicationPath, application, /ACCEPTED_OFFER_LOCKS_APPLICATION/, "accepted offers must only proceed through the controlled hire transition");
expect(applicationPath, application, /TransactionIsolationLevel\.Serializable/, "application stage changes must be serializable with offer state");

const offerPath = "app/api/recruiting/offers/[id]/status/route.ts";
const offer = await source(offerPath);
expect(offerPath, offer, /OFFER_PIPELINE_STATUSES[\s\S]*OfferStatus\.APPROVAL[\s\S]*OfferStatus\.SENT[\s\S]*OfferStatus\.ACCEPTED/, "offer pipeline targets must be modeled explicitly");
expect(offerPath, offer, /OFFER_APPLICATION_STAGES[\s\S]*ApplicationStage\.INTERVIEW[\s\S]*ApplicationStage\.ASSESSMENT[\s\S]*ApplicationStage\.OFFER/, "offer activation must require an offer-eligible application stage");
expect(offerPath, offer, /current\.application\.requisition\.status\s*!==\s*RequisitionStatus\.OPEN/, "offers must not enter approval, be sent or be accepted for a non-open requisition");
expect(offerPath, offer, /current\.expiresAt\s*&&\s*current\.expiresAt\s*<=\s*now/, "expired offers must be blocked before approval, send or acceptance");
expect(offerPath, offer, /tx\.application\.updateMany[\s\S]*stage:\s*current\.application\.stage[\s\S]*applicationUpdate\.count\s*!==\s*1/, "offer activation must synchronize application stage with an optimistic guard");
expect(offerPath, offer, /TransactionIsolationLevel\.Serializable/, "offer lifecycle must remain serializable");

const hirePath = "app/api/recruiting/hire/route.ts";
const hire = await source(hirePath);
expect(hirePath, hire, /can\(ctx,\s*"recruiting:write"\)[\s\S]*can\(ctx,\s*"onboarding:write"\)/, "hire conversion must require both recruiting and onboarding authority");
expect(hirePath, hire, /application\.stage\s*!==\s*ApplicationStage\.OFFER/, "hire conversion must start from the governed offer stage");
expect(hirePath, hire, /application\.offer\.status\s*!==\s*OfferStatus\.ACCEPTED/, "hire conversion must require an accepted offer");
expect(hirePath, hire, /application\.requisition\.status\s*!==\s*RequisitionStatus\.OPEN/, "hire conversion must require an open requisition");
expect(hirePath, hire, /application\.requisition\.openings\s*!==\s*1/, "hire conversion must enforce position-backed capacity semantics");
expect(hirePath, hire, /existingHireCount[\s\S]*application\.requisition\.openings/, "hire conversion must reject exhausted requisition capacity");
expect(hirePath, hire, /where:\s*\{\s*tenantId:\s*ctx\.tenantId,\s*workEmail\s*\}/, "work email uniqueness must be checked within the tenant before employee creation");
expect(hirePath, hire, /tx\.position\.updateMany[\s\S]*status:\s*PositionStatus\.OPEN[\s\S]*positionUpdate\.count\s*!==\s*1/, "position fill must use an optimistic state guard");
expect(hirePath, hire, /tx\.candidate\.updateMany[\s\S]*hiredPersonId:\s*null[\s\S]*candidateUpdate\.count\s*!==\s*1/, "candidate conversion must be single-use and concurrency guarded");
expect(hirePath, hire, /tx\.application\.updateMany[\s\S]*stage:\s*ApplicationStage\.OFFER[\s\S]*applicationUpdate\.count\s*!==\s*1/, "application conversion must be concurrency guarded");
expect(hirePath, hire, /tx\.requisition\.updateMany[\s\S]*status:\s*RequisitionStatus\.OPEN[\s\S]*status:\s*RequisitionStatus\.CLOSED/, "successful single-position hire must close the requisition atomically");
expect(hirePath, hire, /dueDate:\s*actionableDueDate/, "generated onboarding tasks must have actionable due dates");
expect(hirePath, hire, /APPLICATION_CONVERTED_TO_EMPLOYEE/, "recruiting-to-onboarding chain of custody must be audit logged");
expect(hirePath, hire, /TransactionIsolationLevel\.Serializable/, "hire conversion must use serializable transaction isolation");
expect(hirePath, hire, /error\.code\s*===\s*"P2034"[\s\S]*error\.code\s*===\s*"P2002"/, "serialization and uniqueness conflicts must return a safe retryable conflict response");

const maintenancePath = "lib/recruiting-maintenance.ts";
const maintenance = await source(maintenancePath);
expect(maintenancePath, maintenance, /status:\s*OfferStatus\.SENT[\s\S]*expiresAt:\s*\{\s*not:\s*null,\s*lte:\s*now\s*\}/, "maintenance must discover only sent offers whose expiry has elapsed");
expect(maintenancePath, maintenance, /tx\.offer\.updateMany[\s\S]*status:\s*OfferStatus\.SENT[\s\S]*data:\s*\{\s*status:\s*OfferStatus\.EXPIRED\s*\}/, "automatic expiry must use an idempotent guarded update");
expect(maintenancePath, maintenance, /OFFER_STATUS_SENT_TO_EXPIRED/, "automatic expiry must be audit logged");
expect(maintenancePath, maintenance, /RECRUITING_OFFER_EXPIRED/, "automatic expiry must create durable notification intent");
expect(maintenancePath, maintenance, /dedupeKey:\s*`offer:\$\{offer\.id\}:expired`/, "automatic expiry notifications must be idempotent");
expect(maintenancePath, maintenance, /RETENTION_TERMINAL_STAGES[\s\S]*ApplicationStage\.REJECTED[\s\S]*ApplicationStage\.WITHDRAWN/, "candidate retention must only treat rejected and withdrawn applications as terminal erasure states");
expect(maintenancePath, maintenance, /hiredPersonId:\s*null[\s\S]*retentionUntil:\s*\{\s*not:\s*null,\s*lte:\s*now\s*\}[\s\S]*every:\s*\{\s*stage:\s*\{\s*in:\s*RETENTION_TERMINAL_STAGES/, "candidate erasure must require non-hired status, elapsed retention and only terminal applications");
expect(maintenancePath, maintenance, /givenName:\s*"Erased"[\s\S]*familyName:\s*"Candidate"[\s\S]*email:\s*`erased\+\$\{candidate\.id\}@retained\.invalid`/, "candidate PII must be replaced with deterministic non-routable placeholders");
expect(maintenancePath, maintenance, /phone:\s*null[\s\S]*source:\s*null[\s\S]*retentionUntil:\s*null[\s\S]*classification:\s*DataClassification\.INTERNAL/, "candidate direct/contact metadata must be minimized after retention expiry");
expect(maintenancePath, maintenance, /CANDIDATE_PII_ERASED_RETENTION/, "candidate retention erasure must be audit logged");

const maintenanceRoutePath = "app/api/internal/maintenance/route.ts";
const maintenanceRoute = await source(maintenanceRoutePath);
expect(maintenanceRoutePath, maintenanceRoute, /(?:runRecruitingMaintenance\(\)|capture\("recruiting-lifecycle",\s*runRecruitingMaintenance,\s*failures\))/, "internal maintenance must execute recruiting lifecycle normalization");
expect(maintenanceRoutePath, maintenanceRoute, /recruitingLifecycle/, "maintenance response must expose recruiting lifecycle results");

if (failures.length) {
  console.error("Recruiting lifecycle integrity validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated recruiting lifecycle integrity: bounded candidate intake, governed offer preparation, position capacity, application-offer coupling, expiry and requisition guards, accepted-offer hire state, tenant identity uniqueness, optimistic writes, serializable conversion, onboarding deadlines, automated offer expiry, candidate retention minimization and audit chain-of-custody are enforced.");