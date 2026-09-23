import { AppShell } from "@/components/app-shell";
import { AnalyticsModulePage } from "@/components/analytics-module-page";
import { GrowthModulePage } from "@/components/growth-module-page";
import { ModuleLanding } from "@/components/module-landing";
import { PublicCoreLanding } from "@/components/public-core-landing";
import { WorkPayModulePage } from "@/components/work-pay-module-page";
import { getServerRequestContext } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type GrowthSlug = "benefits" | "performance" | "talent" | "succession" | "learning";
type WorkPaySlug = "time-attendance" | "leave" | "compensation" | "payroll";

const publicCoreSlugs = new Set(["people", "organization", "positions", "employee-360"]);
const growthSlugs = new Set<GrowthSlug>(["benefits", "performance", "talent", "succession", "learning"]);
const workPaySlugs = new Set<WorkPaySlug>(["time-attendance", "leave", "compensation", "payroll"]);

export default async function ModulePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const [{ slug }, search, ctx] = await Promise.all([params, searchParams, getServerRequestContext()]);
  const query = typeof search.q === "string" ? search.q : "";
  const personId = typeof search.person === "string" ? search.person : undefined;
  const tab = typeof search.tab === "string" ? search.tab : undefined;

  if (ctx && growthSlugs.has(slug as GrowthSlug)) return <GrowthModulePage slug={slug as GrowthSlug}/>;
  if (ctx && workPaySlugs.has(slug as WorkPaySlug)) return <WorkPayModulePage slug={slug as WorkPaySlug}/>;

  return (
    <AppShell>
      {ctx && slug === "analytics"
        ? <AnalyticsModulePage/>
        : !ctx && publicCoreSlugs.has(slug)
          ? <PublicCoreLanding slug={slug as "people" | "organization" | "positions" | "employee-360"}/>
          : <ModuleLanding slug={slug} query={query} personId={personId} tab={tab}/>} 
    </AppShell>
  );
}