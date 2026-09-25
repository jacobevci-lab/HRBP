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

if (failures.length) {
  console.error("Hire conversion integrity validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated hire conversion integrity: authorized position capacity, accepted-offer state, tenant identity uniqueness, optimistic writes, serializable conversion, onboarding deadlines and audit chain-of-custody are enforced.");
