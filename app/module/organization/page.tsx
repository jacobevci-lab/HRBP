import { CircleAlert, CircleCheckBig } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PublicCoreLanding } from "@/components/public-core-landing";
import { getServerRequestContext } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function renderOrganization() {
  try {
    const { CoreHRLiveWorkspace } = await import("@/components/core-hr-live-workspace");
    return { degraded: false, content: await CoreHRLiveWorkspace({ slug: "organization" }) };
  } catch (liveError) {
    console.error("[HRBP] Dedicated Organization live workspace failed; using staging fallback.", liveError);
    try {
      const { CoreHRWorkspace } = await import("@/components/core-hr-workspace");
      return { degraded: true, content: <CoreHRWorkspace slug="organization"/> };
    } catch (fallbackError) {
      console.error("[HRBP] Dedicated Organization fallback workspace failed.", fallbackError);
      return { degraded: true, content: <section className="card module-table"><div className="empty-state"><h3>Organization workspace is temporarily unavailable</h3><p>The application shell remains healthy while the organization data plane is recovered.</p></div></section> };
    }
  }
}

export default async function OrganizationPage() {
  const ctx = await getServerRequestContext();
  if (!ctx) return <AppShell><PublicCoreLanding slug="organization"/></AppShell>;

  const state = await renderOrganization();
  return (
    <AppShell>
      <section className="page-heading module-heading">
        <div><div className="eyebrow">HRBP One / Organization</div><h1>Organization</h1><p>Model legal entities, business units, departments, teams, cost centers and effective-dated hierarchy changes.</p></div>
        <div className="module-heading-actions">{state.degraded ? <button className="secondary-button" disabled><CircleAlert size={16}/> Protected fallback</button> : <button className="secondary-button" disabled><CircleCheckBig size={16}/> Governed live data</button>}</div>
      </section>
      {state.content}
    </AppShell>
  );
}
