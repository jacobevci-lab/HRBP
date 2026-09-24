import { AppShell } from "@/components/app-shell";
import { AnalyticsModulePage } from "@/components/analytics-module-page";
import { ModuleLanding } from "@/components/module-landing";
import { getServerRequestContext } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AnalyticsPage() {
  const ctx = await getServerRequestContext();
  return <AppShell>{ctx ? <AnalyticsModulePage/> : <ModuleLanding slug="analytics"/>}</AppShell>;
}
