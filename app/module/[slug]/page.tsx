import { AppShell } from "@/components/app-shell";
import { AnalyticsModulePage } from "@/components/analytics-module-page";
import { ConnectionLifecyclePanel } from "@/components/connection-lifecycle-panel";
import { GovernancePlanningModulePage } from "@/components/governance-planning-module-page";
import { GrowthModulePage } from "@/components/growth-module-page";
import { HRServiceEscalationPanel } from "@/components/hr-service-escalation-panel";
import { ModuleLanding } from "@/components/module-landing";
import { NotificationsModulePage } from "@/components/notifications-module-page";
import { PublicCoreLanding } from "@/components/public-core-landing";
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

const publicCoreSlugs = new Set(["people", "organization", "positions", "employee-360"]);
const growthSlugs = new Set<GrowthSlug>(["benefits", "performance", "talent", "succession", "learning"]);
const workPaySlugs = new Set<WorkPaySlug>(["time-attendance", "leave", "compensation", "payroll"]);
const governanceSlugs = new Set<GovernanceSlug>(["engagement", "workforce-planning", "ai-assistant", "privacy"]);

export default async function ModulePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const [{ slug }, search, ctx] = await Promise.all([params, searchParams, getServerRequestContext()]);
  const query = typeof search.q === "string" ? search.q : "";
  const personId = typeof search.person === "string" ? search.person : undefined;
  const tab = typeof search.tab === "string" ? search.tab : undefined;
  const escalation = typeof search.escalation === "string" ? search.escalation : undefined;
  const taskId = typeof search.task === "string" ? search.task : undefined;
  const instanceId = typeof search.instance === "string" ? search.instance : undefined;

  if (ctx && slug === "notifications") return <AppShell><NotificationsModulePage/></AppShell>;
  if (ctx && slug === "settings") return <AppShell><SettingsLivePage/><SecurityPolicyEditorLoader/><ConnectionLifecyclePanel/>{can(ctx, "settings:write") ? <SettingsConnectionsManager/> : null}</AppShell>;
  if (ctx && slug === "analytics") return <AnalyticsModulePage/>;
  if (ctx && growthSlugs.has(slug as GrowthSlug)) return <GrowthModulePage slug={slug as GrowthSlug}/>;
  if (ctx && workPaySlugs.has(slug as WorkPaySlug)) return <WorkPayModulePage slug={slug as WorkPaySlug}/>;
  if (ctx && governanceSlugs.has(slug as GovernanceSlug)) return <GovernancePlanningModulePage slug={slug as GovernanceSlug}/>;

  const workflowAdminVisible = Boolean(ctx && can(ctx, "workflows:read"));

  return (
    <AppShell>
      {!ctx && publicCoreSlugs.has(slug)
        ? <PublicCoreLanding slug={slug as "people" | "organization" | "positions" | "employee-360"}/>
        : <>
            {ctx && slug === "workflows" ? <WorkflowActionCenter initialTaskId={taskId} initialInstanceId={instanceId}/> : null}
            {slug !== "workflows" || !ctx || workflowAdminVisible ? <ModuleLanding slug={slug} query={query} personId={personId} tab={tab}/> : null}
            {ctx && slug === "hr-service" ? <HRServiceEscalationPanel filterValue={escalation}/> : null}
          </>}
    </AppShell>
  );
}
