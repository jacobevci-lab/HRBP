import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const helperPath = "lib/lifecycle-analytics-continuity.ts";
const helper = await source(helperPath);
expect(helperPath, helper, /getLifecycleActionCenterData\(ctx\)/, "analytics continuity must reuse the governed Action Center scope");
expect(helperPath, helper, /summary:\s*\{[\s\S]*total:[\s\S]*overdue:[\s\S]*dueSoon:[\s\S]*critical:[\s\S]*workflow:[\s\S]*hrService:[\s\S]*employeeRelations:/, "analytics continuity must project aggregate counters only");
expect(helperPath, helper, /aggregateOnly:\s*true/, "the projection must explicitly declare its aggregate-only privacy contract");
expect(helperPath, helper, /catch\s*\{[\s\S]*EMPTY_SUMMARY[\s\S]*degraded:\s*true/, "source failure must fail closed with an empty degraded summary");
reject(helperPath, helper, /\.items|items:|title:|subtitle:|subjectId:|requestNumber:|caseNumber:|documentName:|fileName:/, "analytics continuity must not expose record-level lifecycle details");
reject(helperPath, helper, /db\.|findMany\(|findFirst\(|count\(/, "analytics continuity must not bypass source-domain visibility with direct database queries");

const pagePath = "components/analytics-module-page.tsx";
const page = await source(pagePath);
expect(pagePath, page, /can\(ctx,\s*"analytics:read"\)/, "Analytics must remain protected by analytics:read");
expect(pagePath, page, /getLifecycleAnalyticsContinuity\(ctx\)/, "Analytics must consume the governed lifecycle continuity projection");
expect(pagePath, page, /continuity\.summary\.critical/, "Analytics must surface aggregate critical work");
expect(pagePath, page, /continuity\.summary\.overdue/, "Analytics must surface aggregate overdue work");
expect(pagePath, page, /continuity\.summary\.workflow/, "Analytics must surface aggregate workflow work");
expect(pagePath, page, /continuity\.summary\.hrService/, "Analytics must surface aggregate HR Service attention");
expect(pagePath, page, /continuity\.summary\.employeeRelations/, "Analytics must surface aggregate Employee Relations attention");
expect(pagePath, page, /continuity\.degraded[\s\S]*broader tenant query/, "Analytics must communicate fail-closed degradation without broad fallback");
expect(pagePath, page, /\/module\/workflows\?view=critical/, "critical continuity must deep-link into the governed Action Center filter");
expect(pagePath, page, /\/module\/workflows\?view=hr-service/, "HR Service continuity must deep-link into the governed Action Center filter");
expect(pagePath, page, /\/module\/workflows\?view=employee-relations/, "Employee Relations continuity must deep-link into the governed Action Center filter");
reject(pagePath, page, /continuity\.items|continuity\.records|continuity\.cases/, "Analytics UI must never consume restricted lifecycle rows");

const actionCenterPath = "lib/lifecycle-action-center.ts";
const actionCenter = await source(actionCenterPath);
expect(actionCenterPath, actionCenter, /hrServiceRequestWhere\(db,\s*ctx\)/, "source HR Service visibility must remain governed");
expect(actionCenterPath, actionCenter, /ownerUserId:\s*ctx\.actorId[\s\S]*assignments:\s*\{\s*some:/, "source Employee Relations visibility must remain Case Wall scoped");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /lifecycle-analytics:validate/, "lifecycle analytics validation must be wired into package scripts");
expect(packagePath, pkg, /prebuild[\s\S]*lifecycle-analytics:validate/, "lifecycle analytics validation must run before production builds");

if (failures.length) {
  console.error("Lifecycle analytics continuity validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Lifecycle analytics continuity validation passed.");
