import { AppShell } from "@/components/app-shell";
import { Dashboard } from "@/components/dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Home() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}
