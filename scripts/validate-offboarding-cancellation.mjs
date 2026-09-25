import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const schemaPath = "prisma/offboarding.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /cancellationReason\s+String\?/, "separation cancellation reason must be persisted");
expect(schemaPath, schema, /cancelledById\s+String\?/, "separation cancellation actor must be persisted");
expect(schemaPath, schema, /cancelledAt\s+DateTime\?/, "separation cancellation time must be persisted");

const routePath = "app/api/offboarding/processes/[id]/cancel/route.ts";
const route = await source(routePath);
expect(routePath, route, /mutationOriginAllowed\(request\)/, "cancellation must reject cross-origin mutations");
expect(routePath, route, /can\(ctx,\s*"offboarding:write"\)/, "cancellation must require offboarding write capability");
expect(routePath, route, /resolveEmploymentScope[\s\S]*canActOnEmployment/, "cancellation must enforce relationship scope");
expect(routePath, route, /asText\(body\.reason,\s*2000\)/, "cancellation reason must be bounded");
expect(routePath, route, /reason\.length\s*<\s*10/, "cancellation reason must have a meaningful minimum length");
expect(routePath, route, /finalSettlementStatus\s*===\s*"SETTLED"/, "settled final pay must block simple cancellation");
expect(routePath, route, /separationProcess\.updateMany\([\s\S]*status:\s*process\.status[\s\S]*status:\s*SeparationStatus\.CANCELLED/, "cancellation must use a state-aware process transition");
expect(routePath, route, /cancellationReason:\s*reason[\s\S]*cancelledById:\s*ctx\.actorId[\s\S]*cancelledAt:\s*now/, "cancellation must record reason, actor and time");
expect(routePath, route, /notificationOutbox\.updateMany[\s\S]*SeparationProcess[\s\S]*SeparationTask/, "cancellation must retire stale process and task notifications");
expect(routePath, route, /offboarding\.process-cancelled/, "cancellation must append audit evidence");
expect(routePath, route, /TransactionIsolationLevel\.Serializable/, "cancellation must use serializable isolation");
expect(routePath, route, /P2034/, "cancellation must handle serialization conflicts");

const consolePath = "components/offboarding-operations-console.tsx";
const consoleSource = await source(consolePath);
expect(consolePath, consoleSource, /\/cancel`/, "operations UI must call the governed cancellation route");
expect(consolePath, consoleSource, /maxLength=\{2000\}/, "cancellation UI must mirror the server reason bound");
expect(consolePath, consoleSource, /cancelEditor\.text\.trim\(\)\.length<10/, "cancellation UI must require a meaningful reason");
expect(consolePath, consoleSource, /process\.finalSettlementClear/, "operations UI must surface the settled-payment cancellation guard");
expect(consolePath, consoleSource, /Employment remains active|İstihdam aktif kalır/, "cancellation UI must distinguish cancellation from employment termination");

if (failures.length) {
  console.error("Offboarding cancellation governance validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Offboarding cancellation governance validation passed.");
