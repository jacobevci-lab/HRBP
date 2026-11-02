import { AppShell } from "@/components/app-shell";
import { JobArchitectureWorkspace } from "@/components/job-architecture-workspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function JobArchitecturePage() {
  return <AppShell><JobArchitectureWorkspace/></AppShell>;
}
