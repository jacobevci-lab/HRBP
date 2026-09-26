import { AppShell } from "@/components/app-shell";
import { AnalyticsModulePage } from "@/components/analytics-module-page";
import { AuditLivePage } from "@/components/audit-live-page";
import { ConnectionLifecyclePanel } from "@/components/connection-lifecycle-panel";
import { EmployeeRelationsCaseLifecyclePanel } from "@/components/employee-relations-case-lifecycle-panel";
import { GovernancePlanningModulePage } from "@/components/governance-planning-module-page";
import { GrowthModulePage } from "@/components/growth-module-page";
import { HRServiceEscalationPanel } from "@/components/hr-service-escalation-panel";
import { HRServiceLifecyclePanel } from "@/components/hr-service-lifecycle-panel";
import { ModuleLanding } from "@/components/module-landing";
import { NotificationsModulePage } from "@/components/notifications-module-page";
import { OffboardingClearanceLoader } from "@/components/offboarding-clearance-loader";
import { PublicModuleLanding } from "@/components/public-module-landing";
import { SecurityPolicyEditorLoader } from "@/components/security-policy-editor-loader";
import { SettingsConnectionsManager } from "@/components/settings-connections-manager";
import { SettingsLivePage } from "@/components/settings-live-page";
import { WorkflowActionCenter } from "@/components/workflow-action-center";
import { WorkPayModulePage } from "@/components/work-pay-module-page";
import { can } from "@/lib/authorization";
import { getServerRequestContext } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type GrowthSlug = "benefits" | "performance" | "talent" | "succession" | "learning";
type WorkPaySlug = "time-attendance" | "leave" | "compensation" | "payroll";
type GovernanceSlug = "engagement" | "workforce-planning" | "ai-assistant" | "privacy";

const growthSlugs = new Set<GrowthSlug>(["benefits", "performance", "talent", "succession", "learning"]);
const workPaySlugs = new Set<WorkPaySlug>(["time-attendance", "leave", "compensation", "payroll"]);
const governanceSlugs = new Set<GovernanceSlug>(["engagement", "workforce-planning", "ai-assistant", "privacy"]);

export default async function ModulePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const [{ slug }, search, ctx] = await Promise.all([params, searchParams, getServerRequestContext()]);
  const explicitQuery = typeof search.q === "string" ? search.q : "";
  const requestFocus = typeof search.request === "string" ? search.request : "";
  const personId = typeof search.person === "string" ? search.person : undefined;
  const documentFocus = typeof search.document === "string" ? search.document : undefined;
  const documentLifecycleQuery = slug === "documents" ? (documentFocus || personId || "") : "";
  const query = explicitQuery || requestFocus || documentLifecycleQuery;
  const tab = typeof search.tab === "string" ? search.tab : undefined;
  const escalation = typeof search.escalation === "string" ? search.escalation : undefined;
  const taskId = typeof search.task === "string" ? search.task : undefined;
  const instanceId = typeof search.instance === "string" ? search.instance : undefined;
  const actionView = typeof search.view === "string" ? search.view : undefined;
  const employeeRelationsCaseId = typeof search.case === "string" ? search.case : undefined;
  const employeeRelationsActionId = typeof search.action === "string" ? search.action : undefined;
  const employeeRelationsAppealId = typeof search.appeal === "string" ? search.appeal : undefined;

  if (!ctx) return <AppShell><PublicModuleLanding slug={slug}/></AppShell>;

  if (slug === "notifications") return <AppShell><NotificationsModulePage/></AppShell>;
  if (slug === "settings") return <AppShell><SettingsLivePage/><SecurityPolicyEditorLoader/><ConnectionLifecyclePanel/>{can(ctx, "settings:write") ? <SettingsConnectionsManager/> : null}</AppShell>;
  if (slug === "audit") return <AppShell><AuditLivePage searchParams={search}/></AppShell>;
  if (slug === "analytics") return <AnalyticsModulePage/>;
  if (growthSlugs.has(slug as GrowthSlug)) return <GrowthModulePage slug={slug as GrowthSlug}/>;
  if (workPaySlugs.has(slug as WorkPaySlug)) return <WorkPayModulePage slug={slug as WorkPaySlug}/>;
  if (governanceSlugs.has(slug as GovernanceSlug)) return <GovernancePlanningModulePage slug={slug as GovernanceSlug}/>;

  const workflowAdminVisible = can(ctx, "workflows:read");

  return (
    <AppShell>
      {slug === "workflows" ? <WorkflowActionCenter initialTaskId={taskId} initialInstanceId={instanceId} initialFilter={actionView}/> : null}
      {slug !== "workflows" || workflowAdminVisible ? <ModuleLanding slug={slug} query={query} personId={personId} tab={tab}/> : null}
      {slug === "offboarding" && can(ctx, "offboarding:write") ? <OffboardingClearanceLoader/> : null}
      {slug === "employee-relations" ? <EmployeeRelationsCaseLifecyclePanel focus={{ query, caseId: employeeRelationsCaseId, actionId: employeeRelationsActionId, appealId: employeeRelationsAppealId }}/> : null}
      {slug === "hr-service" ? <HRServiceLifecyclePanel focus={query}/> : null}
      {slug === "hr-service" ? <HRServiceEscalationPanel filterValue={escalation}/> : null}
    </AppShell>
  );
}
