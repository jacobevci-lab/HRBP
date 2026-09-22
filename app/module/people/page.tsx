import Link from "next/link";
import { CircleAlert, CircleCheckBig, Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function renderPeople(query: string) {
  try {
    const { CoreHRLiveWorkspace } = await import("@/components/core-hr-live-workspace");
    return { degraded: false, content: await CoreHRLiveWorkspace({ slug: "people", query }) };
  } catch (liveError) {
    console.error("[HRBP] Dedicated People live workspace failed; using staging fallback.", liveError);
    try {
      const { CoreHRWorkspace } = await import("@/components/core-hr-workspace");
      return { degraded: true, content: <CoreHRWorkspace slug="people"/> };
    } catch (fallbackError) {
      console.error("[HRBP] Dedicated People fallback workspace failed.", fallbackError);
      return {
        degraded: true,
        content: (
          <section className="card module-table">
            <div className="empty-state">
              <h3>People directory is temporarily unavailable</h3>
              <p>The navigation shell is healthy, but the People data plane could not initialize. Protected mutations remain disabled until the workspace recovers.</p>
              <Link className="secondary-button" href="/">Return to Command Center</Link>
            </div>
          </section>
        )
      };
    }
  }
}

export default async function PeoplePage({ searchParams }: { searchParams: SearchParams }) {
  const search = await searchParams;
  const query = typeof search.q === "string" ? search.q : "";
  const state = await renderPeople(query);

  return (
    <AppShell>
      <section className="page-heading module-heading">
        <div>
          <div className="eyebrow">HRBP One / People</div>
          <h1>People</h1>
          <p>The employee golden record: identity, employment, position, organization and lifecycle history in one governed workspace.</p>
        </div>
        <div className="module-heading-actions">
          {state.degraded
            ? <button className="secondary-button" disabled><CircleAlert size={16}/> Protected fallback</button>
            : <button className="secondary-button" disabled><CircleCheckBig size={16}/> Governed live data</button>}
          <Link className="create-button" href="/module/people/new"><Plus size={17}/> Add employee</Link>
        </div>
      </section>

      {state.degraded ? (
        <section className="card" style={{ marginBottom: 14, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <CircleAlert size={18} style={{ flex: "0 0 auto", marginTop: 1 }}/>
          <div>
            <strong style={{ display: "block", fontSize: 11 }}>People is running in protected fallback mode</strong>
            <p style={{ margin: "3px 0 0", fontSize: 9.5, lineHeight: 1.5 }}>The live PostgreSQL path could not be initialized. The directory remains navigable with safe staging records while protected mutations stay disabled.</p>
          </div>
        </section>
      ) : null}

      {state.content}
    </AppShell>
  );
}
