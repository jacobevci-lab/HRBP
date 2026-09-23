import { AppShell } from "@/components/app-shell";
import { AnalyticsModulePage } from "@/components/analytics-module-page";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AnalyticsPage() {
  return <AppShell><AnalyticsModulePage/></AppShell>;
}
