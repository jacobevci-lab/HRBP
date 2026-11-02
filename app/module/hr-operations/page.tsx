import { AppShell } from "@/components/app-shell";
import { HROperationsHub } from "@/components/hr-operations-hub";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HROperationsHubPage() {
  return <AppShell><HROperationsHub/></AppShell>;
}
