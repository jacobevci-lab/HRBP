import { CircleAlert, CircleCheckBig } from "lucide-react";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function renderOffboarding() {
  try {
    const { OffboardingWorkspace } = await import("@/components/offboarding-workspace");
    return { degraded: false, content: await OffboardingWorkspace() };
  } catch (error) {
    console.error("[HRBP] Dedicated Offboarding workspace failed.", error);
    return {
      degraded: true,
      content: <section className="card module-table"><div className="empty-state"><h3>Offboarding is temporarily unavailable</h3><p>The separation data plane could not initialize. No employee exit mutation was attempted.</p></div></section>
    };
  }
}

export default async function OffboardingPage() {
  const state = await renderOffboarding();
  return <AppShell>
    <section className="page-heading module-heading">
      <div><div className="eyebrow">HRBP One / Offboarding</div><h1>Offboarding</h1><p>Orchestrate controlled employee exits across HR, managers, identity, assets and payroll before the employment record can close.</p></div>
      <div className="module-heading-actions">{state.degraded ? <button className="secondary-button" disabled><CircleAlert size={16}/> Protected fallback</button> : <button className="secondary-button" disabled><CircleCheckBig size={16}/> Governed exit workflow</button>}</div>
    </section>
    {state.content}
  </AppShell>;
}
