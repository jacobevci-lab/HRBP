import Link from "next/link";
import { CircleAlert, CircleCheckBig, Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PublicCoreLanding } from "@/components/public-core-landing";
import { getServerRequestContext } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function renderPositions() {
  try {
    const { CoreHRLiveWorkspace } = await import("@/components/core-hr-live-workspace");
    return { degraded: false, content: await CoreHRLiveWorkspace({ slug: "positions" }) };
  } catch (liveError) {
    console.error("[HRBP] Dedicated Positions live workspace failed; using staging fallback.", liveError);
    try {
      const { CoreHRWorkspace } = await import("@/components/core-hr-workspace");
      return { degraded: true, content: <CoreHRWorkspace slug="positions"/> };
    } catch (fallbackError) {
      console.error("[HRBP] Dedicated Positions fallback workspace failed.", fallbackError);
      return { degraded: true, content: <section className="card module-table"><div className="empty-state"><h3>Positions workspace is temporarily unavailable</h3><p>The application shell remains healthy while the position data plane is recovered.</p></div></section> };
    }
  }
}

export default async function PositionsPage() {
  const ctx = await getServerRequestContext();
  if (!ctx) return <AppShell><PublicCoreLanding slug="positions"/></AppShell>;

  const state = await renderPositions();
  return (
    <AppShell>
      <section className="page-heading module-heading">
        <div><div className="eyebrow">HRBP One / Positions</div><h1>Positions</h1><p>Manage budgeted seats independently from incumbents, with status, grade, location, criticality and history.</p></div>
        <div className="module-heading-actions">
          {state.degraded ? <button className="secondary-button" disabled><CircleAlert size={16}/> Protected fallback</button> : <button className="secondary-button" disabled><CircleCheckBig size={16}/> Governed live data</button>}
          <Link className="create-button" href="/module/positions/new"><Plus size={17}/> New position</Link>
        </div>
      </section>
      {state.content}
    </AppShell>
  );
}
