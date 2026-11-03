import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { AnalyticsModulePage } from "@/components/analytics-module-page";
import { AuditLivePage } from "@/components/audit-live-page";
import { ActionCenterDecisionHistory } from "@/components/action-center-decision-history";
import { ConnectionLifecyclePanel } from "@/components/connection-lifecycle-panel";
import { ConnectionMetadataEditor } from "@/components/connection-metadata-editor";
import { EmployeeRelationsCaseLifecyclePanel } from "@/components/employee-relations-case-lifecycle-panel";
import { GovernancePlanningModulePage } from "@/components/governance-planning-module-page";
import { GrowthModulePage } from "@/components/growth-module-page";
import { pickGrowthFocus } from "@/lib/growth-route-focus";
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
import { isHRServiceSelfServiceRole } from "@/lib/hr-service-access";
import { getServerRequestContext } from "@/lib/server-session";
import { getServerLocale } from "@/lib/i18n-server";

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
  const [{ slug }, search, ctx, locale] = await Promise.all([params, searchParams, getServerRequestContext(), getServerLocale()]);
  const explicitQuery = typeof search.q === "string" ? search.q : "";
  const requestFocus = typeof search.request === "string" ? search.request : "";
  const entryFocus = typeof search.entry === "string" ? search.entry : "";
  const compensationFocus = typeof search.change === "string" ? search.change : "";
  const payrollFocus = typeof search.run === "string" ? search.run : "";
  const personId = typeof search.person === "string" ? search.person : undefined;
  const documentFocus = typeof search.document === "string" ? search.document : undefined;
  const policyFocus = typeof search.policy === "string" ? search.policy : undefined;
  const scenarioFocus = typeof search.scenario === "string" ? search.scenario : undefined;
  const dsrFocus = typeof search.dsr === "string" ? search.dsr : undefined;
  const privacyAssessmentFocus = typeof search.assessment === "string" ? search.assessment : undefined;
  const privacyTransferFocus = typeof search.transfer === "string" ? search.transfer : undefined;
  const campaignFocus = typeof search.campaign === "string" ? search.campaign : undefined;
  const workflowDefinitionFocus = typeof search.definition === "string" ? search.definition : undefined;
  const lifecycleMode = typeof search.mode === "string" ? search.mode : undefined;
  const documentLifecycleQuery = slug === "documents" ? (documentFocus || personId || "") : "";
  const policyLifecycleQuery = slug === "policies" ? (policyFocus || "") : "";
  const workflowLifecycleQuery = slug === "workflows" ? (workflowDefinitionFocus || "") : "";
  const query = explicitQuery || requestFocus || documentLifecycleQuery || policyLifecycleQuery || workflowLifecycleQuery;
  const tab = typeof search.tab === "string" ? search.tab : undefined;
  const escalation = typeof search.escalation === "string" ? search.escalation : undefined;
  const taskId = typeof search.task === "string" ? search.task : undefined;
  const instanceId = typeof search.instance === "string" ? search.instance : undefined;
  const actionView = typeof search.view === "string" ? search.view : undefined;
  const statusFilter = typeof search.status === "string" ? search.status.slice(0, 40) : undefined;
  const rawColumns = Array.isArray(search.columns) ? search.columns : typeof search.columns === "string" ? [search.columns] : [];
  const columnFilter = rawColumns.slice(0, 12).map((value) => value.slice(0, 40));
  const columnsCustomized = search.columnsMode === "custom";
  const density = search.density === "compact" ? "compact" as const : "comfortable" as const;
  const sortKey = typeof search.sort === "string" ? search.sort.slice(0, 40) : undefined;
  const sortDirection = search.dir === "desc" ? "desc" as const : "asc" as const;
  const employeeRelationsCaseId = typeof search.case === "string" ? search.case : undefined;
  const employeeRelationsActionId = typeof search.action === "string" ? search.action : undefined;
  const employeeRelationsAppealId = typeof search.appeal === "string" ? search.appeal : undefined;
  const workPayFocus = slug === "leave"
    ? requestFocus
    : slug === "time-attendance"
      ? entryFocus
      : slug === "compensation"
        ? compensationFocus
        : slug === "payroll"
          ? payrollFocus
          : undefined;
  const growthFocus = growthSlugs.has(slug as GrowthSlug)
    ? pickGrowthFocus(slug as GrowthSlug, search)
    : undefined;

  if (!ctx) return <AppShell><PublicModuleLanding slug={slug}/></AppShell>;

  if (slug === "notifications") return <AppShell><NotificationsModulePage/></AppShell>;
  if (slug === "settings") return <AppShell><SettingsLivePage/><SecurityPolicyEditorLoader/><ConnectionLifecyclePanel/>{can(ctx, "settings:write") ? <><SettingsConnectionsManager/><ConnectionMetadataEditor/></> : null}</AppShell>;
  if (slug === "audit") return <AppShell><AuditLivePage searchParams={search}/></AppShell>;
  if (slug === "analytics") return <AnalyticsModulePage/>;
  if (growthSlugs.has(slug as GrowthSlug)) return <GrowthModulePage slug={slug as GrowthSlug} focusId={growthFocus}/>;
  if (workPaySlugs.has(slug as WorkPaySlug)) return <WorkPayModulePage slug={slug as WorkPaySlug} focusId={workPayFocus}/>;
  if (governanceSlugs.has(slug as GovernanceSlug)) return <GovernancePlanningModulePage slug={slug as GovernanceSlug} focusId={slug === "workforce-planning" ? scenarioFocus : slug === "privacy" ? (privacyAssessmentFocus || privacyTransferFocus || dsrFocus) : slug === "engagement" ? campaignFocus : undefined} mode={lifecycleMode}/>;

  const workflowAdminVisible = can(ctx, "workflows:read");
  if (slug === "workflows") {
    const workflowAdminMode = workflowAdminVisible && lifecycleMode === "admin";
    return <AppShell>
      {workflowAdminMode ? <>
        <div className="my-work-admin-return"><Link className="secondary-button" href="/module/workflows">{locale === "tr" ? "← İşlerim" : "← My Work"}</Link></div>
        <ModuleLanding slug="workflows" query={query} tab="admin"/>
      </> : <>
        <WorkflowActionCenter initialTaskId={taskId} initialInstanceId={instanceId} initialFilter={actionView} showAdministrationLink={workflowAdminVisible}/>
        <details className="my-work-history-panel">
          <summary><span>{locale === "tr" ? "Karar geçmişi" : "Decision history"}</span><small>{locale === "tr" ? "Denetim izi ve tamamlanan kararlar" : "Audit trail and completed decisions"}</small></summary>
          <ActionCenterDecisionHistory/>
        </details>
      </>}
    </AppShell>;
  }

  return (
    <AppShell>
      <ModuleLanding slug={slug} query={query} status={statusFilter} columns={columnFilter} columnsCustomized={columnsCustomized} density={density} sortKey={sortKey} sortDirection={sortDirection} personId={personId} tab={slug === "policies" ? lifecycleMode : tab}/>
      {slug === "offboarding" && can(ctx, "offboarding:write") ? <OffboardingClearanceLoader/> : null}
      {slug === "employee-relations" ? <details id="er-lifecycle" className="service-governance-panel" open={Boolean(query || employeeRelationsCaseId || employeeRelationsActionId || employeeRelationsAppealId)}>
        <summary><span><strong>{locale === "tr" ? "Vaka yaşam döngüsü & kapanış" : "Case lifecycle & closure"}</strong><small>{locale === "tr" ? "Çözüm, düzeltici aksiyon ve itiraz kontrollerini gerektiğinde açın." : "Open resolution, corrective-action and appeal controls when needed."}</small></span><span>Case Wall</span></summary>
        <div className="service-governance-panel-body"><EmployeeRelationsCaseLifecyclePanel focus={{ query, caseId: employeeRelationsCaseId, actionId: employeeRelationsActionId, appealId: employeeRelationsAppealId }}/></div>
      </details> : null}
      {slug === "hr-service" ? <details id="hr-service-lifecycle" className="service-governance-panel" open={Boolean(query)}>
        <summary><span><strong>{locale === "tr" ? "Hizmet yaşam döngüsü & yanıtlar" : "Service lifecycle & replies"}</strong><small>{locale === "tr" ? "Geçiş geçmişi, SLA duraklamaları ve yönetişimli aksiyonları gerektiğinde açın." : "Open transition history, SLA pauses and governed actions when needed."}</small></span><span>{locale === "tr" ? "Yönetişimli" : "Governed"}</span></summary>
        <div className="service-governance-panel-body"><HRServiceLifecyclePanel focus={query}/></div>
      </details> : null}
      {slug === "hr-service" && !isHRServiceSelfServiceRole(ctx.role) ? <details id="hr-service-escalation" className="service-governance-panel" open={Boolean(escalation)}>
        <summary><span><strong>{locale === "tr" ? "SLA eskalasyon operasyonları" : "SLA escalation operations"}</strong><small>{locale === "tr" ? "Uyarı, ihlal ve kritik eskalasyonları gerektiğinde açın." : "Open warning, breached and severe escalation queues when needed."}</small></span><span>SLA</span></summary>
        <div className="service-governance-panel-body"><HRServiceEscalationPanel filterValue={escalation}/></div>
      </details> : null}
    </AppShell>
  );
}
