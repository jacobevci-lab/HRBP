import Link from "next/link";
import { CircleAlert, CircleCheckBig, Workflow } from "lucide-react";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function renderEmployee360(personId?: string, tab?: string) {
  try {
    const { CoreHRLiveWorkspace } = await import("@/components/core-hr-live-workspace");
    return { degraded: false, content: await CoreHRLiveWorkspace({ slug: "employee-360", personId, tab }) };
  } catch (liveError) {
    console.error("[HRBP] Dedicated Employee 360 live workspace failed; using protected fallback.", liveError);
    try {
      const { CoreHRWorkspace } = await import("@/components/core-hr-workspace");
      return { degraded: true, content: <CoreHRWorkspace slug="employee-360"/> };
    } catch (fallbackError) {
      console.error("[HRBP] Dedicated Employee 360 fallback workspace failed.", fallbackError);
      return { degraded: true, content: <section className="card module-table"><div className="empty-state"><h3>Employee 360 is temporarily unavailable</h3><p>The employee detail data plane could not initialize. Return to People while the workspace recovers.</p><Link className="secondary-button" href="/module/people">Back to People</Link></div></section> };
    }
  }
}

export default async function Employee360Page({ searchParams }: { searchParams: SearchParams }) {
  const search = await searchParams;
  const personId = typeof search.person === "string" ? search.person : undefined;
  const tab = typeof search.tab === "string" ? search.tab : undefined;
  const state = await renderEmployee360(personId, tab);

  return (
    <AppShell>
      <section className="page-heading module-heading">
        <div><div className="eyebrow">HRBP One / Employee 360</div><h1>Employee 360</h1><p>A policy-aware view of the complete employee relationship without collapsing restricted security boundaries.</p></div>
        <div className="module-heading-actions">
          {state.degraded ? <button className="secondary-button" disabled><CircleAlert size={16}/> Protected fallback</button> : <button className="secondary-button" disabled><CircleCheckBig size={16}/> Governed live data</button>}
          {personId && !state.degraded ? <Link className="create-button" href={`/module/employee-360/lifecycle?person=${encodeURIComponent(personId)}`}><Workflow size={16}/> Lifecycle actions</Link> : null}
          <Link className="secondary-button" href="/module/people">People directory</Link>
        </div>
      </section>
      {state.content}
    </AppShell>
  );
}
