import { AppShell } from "@/components/app-shell";
import { ManagerHub } from "@/components/manager-hub";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ManagerHubPage() {
  return <AppShell><ManagerHub/></AppShell>;
}
