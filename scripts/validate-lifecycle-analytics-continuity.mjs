import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const helperPath = "lib/lifecycle-analytics-continuity.ts";
const helper = await source(helperPath);
expect(helperPath, helper, /getLifecycleActionCenterData\(ctx\)/, "analytics continuity must reuse the governed Action Center scope");
for (const counter of ["total", "overdue", "dueSoon", "critical", "workflow", "hrService", "employeeRelations", "documents", "leave", "timeAttendance", "compensation", "payroll"]) {
  expect(helperPath, helper, new RegExp(`${counter}:\\s*source\\.summary\\.${counter}`), `analytics continuity must copy only the governed ${counter} counter`);
}
expect(helperPath, helper, /aggregateOnly:\s*true/, "the projection must explicitly declare its aggregate-only privacy contract");
expect(helperPath, helper, /catch\s*\{[\s\S]*EMPTY_SUMMARY[\s\S]*degraded:\s*true/, "source failure must fail closed with an empty degraded summary");
reject(helperPath, helper, /\.items|items:|title:|subtitle:|subjectId:|requestNumber:|caseNumber:|documentName:|fileName:|employeeName:/, "analytics continuity must not expose record-level lifecycle details");
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
expect(pagePath, page, /continuity\.summary\.documents/, "Analytics must surface aggregate document expiry attention without document metadata");
expect(pagePath, page, /continuity\.degraded[\s\S]*broader tenant query/, "Analytics must communicate fail-closed degradation without broad fallback");
expect(pagePath, page, /\/module\/workflows\?view=critical/, "critical continuity must deep-link into the governed Action Center filter");
expect(pagePath, page, /\/module\/workflows\?view=hr-service/, "HR Service continuity must deep-link into the governed Action Center filter");
expect(pagePath, page, /\/module\/workflows\?view=employee-relations/, "Employee Relations continuity must deep-link into the governed Action Center filter");
expect(pagePath, page, /\/module\/workflows\?view=documents/, "Document continuity must deep-link into the governed Action Center filter");
reject(pagePath, page, /continuity\.items|continuity\.records|continuity\.cases|continuity\.documents\./, "Analytics UI must never consume restricted lifecycle rows or document metadata");

const actionCenterPath = "lib/lifecycle-action-center.ts";
const actionCenter = await source(actionCenterPath);
expect(actionCenterPath, actionCenter, /hrServiceRequestWhere\(db,\s*ctx\)/, "source HR Service visibility must remain governed");
expect(actionCenterPath, actionCenter, /ownerUserId:\s*ctx\.actorId[\s\S]*assignments:\s*\{\s*some:/, "source Employee Relations visibility must remain Case Wall scoped");
expect(actionCenterPath, actionCenter, /documentVisibilityWhere\(db,\s*ctx\)/, "source document visibility must remain governed by the existing document scope");
expect(actionCenterPath, actionCenter, /resolveEmploymentScope\(db,\s*ctx\)/, "source relationship-scoped work-pay visibility must remain employment scoped");
expect(actionCenterPath, actionCenter, /requestedById:\s*\{\s*not:\s*ctx\.actorId\s*\}/, "compensation aggregate attention must preserve four-eyes separation at source");
expect(actionCenterPath, actionCenter, /creators\.get\(row\.id\) !== ctx\.actorId/, "payroll approval attention must exclude the run creator at source");
expect(actionCenterPath, actionCenter, /row\.approvedById !== ctx\.actorId/, "payroll payment attention must exclude the approver at source");
reject(actionCenterPath, actionCenter, /objectKey|contentHash|scanMessage|currentAnnualBase|proposedAnnualBase|grossPay|netPay|employerCost/, "lifecycle aggregation must not load restricted storage, compensation amounts or payroll results");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /lifecycle-analytics:validate/, "lifecycle analytics validation must be wired into package scripts");
expect(packagePath, pkg, /prebuild[\s\S]*lifecycle-analytics:validate/, "lifecycle analytics validation must run before production builds");

if (failures.length) {
  console.error("Lifecycle analytics continuity validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Lifecycle analytics continuity validation passed.");
