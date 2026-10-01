import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(path + ": " + message); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(path + ": " + message); }

const intakePath = "app/api/ai/interactions/route.ts";
const intake = await source(intakePath);
expect(intakePath, intake, /mutationOriginAllowed\(request\)/, "AI request intake must enforce origin checks");
expect(intakePath, intake, /MAX_PROMPT_LENGTH = 12_000/, "AI prompts must be bounded");
expect(intakePath, intake, /MAX_SOURCE_REFS = 25/, "AI source references must be bounded");
expect(intakePath, intake, /HIGHLY_RESTRICTED/, "general AI assistant must reject highly restricted input");
expect(intakePath, intake, /promptHash:\s*createHash\("sha256"\)/, "raw prompts must not be persisted");
reject(intakePath, intake, /prompt:\s*prompt[,}]/, "raw prompt content must not be written to the AIInteraction record");

const dispatchPath = "lib/ai-processor-dispatch.ts";
const dispatch = await source(dispatchPath);
expect(dispatchPath, dispatch, /HRBP_AI_PROCESSOR_URL/, "AI intake must dispatch raw prompts only to a configured processor endpoint");
expect(dispatchPath, dispatch, /HRBP_AI_PROCESSOR_TOKEN/, "AI processor dispatch must use bearer credentials");
expect(dispatchPath, dispatch, /url\.protocol !== "https:"/, "production AI dispatch must require HTTPS");
expect(dispatchPath, dispatch, /setTimeout\(\(\) => controller\.abort\(\), 10_000\)/, "AI processor dispatch must be time bounded");
expect(dispatchPath, dispatch, /prompt:\s*input\.prompt/, "raw prompt may exist only in the transient processor dispatch payload");

expect(intakePath, intake, /dispatchAIInteraction/, "AI intake must dispatch transient prompt content after audit record creation");
expect(intakePath, intake, /ai\.interaction-dispatch-failed/, "AI dispatch failure must be recorded on the audit chain");
expect(intakePath, intake, /status:\s*AIInteractionStatus\.FAILED/, "undeliverable AI requests must not remain indefinitely RECEIVED");

const routePath = "app/api/internal/ai/interactions/[id]/lifecycle/route.ts";
const route = await source(routePath);
expect(routePath, route, /internalBearerAuthorized\(request,\s*"HRBP_AI_PROCESSOR_TOKEN"\)/, "AI lifecycle must require an internal processor token");
expect(routePath, route, /START[\s\S]*COMPLETE[\s\S]*BLOCK[\s\S]*FAIL/, "AI lifecycle must support processing, completion, blocking and failure");
expect(routePath, route, /AIInteractionStatus\.RECEIVED/, "AI lifecycle must start from RECEIVED");
expect(routePath, route, /AIInteractionStatus\.PROCESSING/, "AI lifecycle must include PROCESSING");
expect(routePath, route, /AIInteractionStatus\.COMPLETED/, "AI lifecycle must include COMPLETED");
expect(routePath, route, /AIInteractionStatus\.BLOCKED/, "AI lifecycle must include BLOCKED");
expect(routePath, route, /AIInteractionStatus\.FAILED/, "AI lifecycle must include FAILED");
expect(routePath, route, /terminalizable\.has\(current\.status\)/, "terminal transitions must use type-safe state guards");
expect(routePath, route, /responseHash:\s*createHash\("sha256"\)\.update\(response\)/, "completed output must retain only a response hash");
reject(routePath, route, /responseMarkdown|responseText|rawResponse/, "raw model output must not be persisted");
expect(routePath, route, /appendSystemAudit/, "internal AI processor transitions must stay on the append-only audit chain");
expect(routePath, route, /system:ai-processor/, "AI processor audits must use a distinct system actor");
expect(routePath, route, /modelProvider/, "AI completion must retain model provider provenance");
expect(routePath, route, /modelName/, "AI completion must retain model identity");

const auditPath = "lib/audit.ts";
const audit = await source(auditPath);
expect(auditPath, audit, /appendSystemAudit/, "append-only audit helper must support explicit system actors");
expect(auditPath, audit, /appendAuditActor/, "human and system audit writes must share the same hash-chain implementation");

const uiPath = "components/ai-interaction-request-form.tsx";
const ui = await source(uiPath);
expect(uiPath, ui, /\/api\/ai\/interactions/, "AI request form must use the governed intake route");
expect(uiPath, ui, /Raw prompts and raw responses are not retained/, "AI UI must communicate minimal-retention behavior");
expect(uiPath, ui, /HIGHLY_RESTRICTED|Restricted/, "AI request form must expose controlled classification choices");

const workspacePath = "components/governance-planning-live-workspace.tsx";
const workspace = await source(workspacePath);
expect(workspacePath, workspace, /AIInteractionRequestForm/, "AI request form must be mounted in the AI Assistant workspace");

const dataPath = "lib/governance-planning-live-data.ts";
const data = await source(dataPath);
expect(dataPath, data, /promptHash\.slice\(0, 12\)/, "AI ledger may expose only a prompt fingerprint");
expect(dataPath, data, /responseRecorded:\s*Boolean\(interaction\.responseHash\)/, "AI ledger may expose only response presence, not raw content");
reject(dataPath, data, /responseText|rawPrompt|rawResponse/, "AI live data must not project raw prompts or responses");

const envPath = ".env.example";
const env = await source(envPath);
expect(envPath, env, /HRBP_AI_PROCESSOR_TOKEN=replace-with-at-least-24-random-characters/, "AI processor token must be documented");
expect(envPath, env, /HRBP_AI_PROCESSOR_URL=https:\/\//, "AI processor endpoint must be documented");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /ai-interaction-lifecycle:validate/, "AI lifecycle validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*ai-interaction-lifecycle:validate/, "AI lifecycle validation must run before production builds");

if (failures.length) {
  console.error("AI interaction lifecycle validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("AI interaction lifecycle validation passed.");
