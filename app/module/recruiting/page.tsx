import { CircleAlert, CircleCheckBig } from "lucide-react";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function renderRecruiting() {
  try {
    const { RecruitingWorkspace } = await import("@/components/recruiting-workspace");
    return { degraded: false, content: await RecruitingWorkspace({ slug: "recruiting" }) };
  } catch (error) {
    console.error("[HRBP] Dedicated Recruiting workspace failed.", error);
    return { degraded: true, content: <section className="card module-table"><div className="empty-state"><h3>Recruiting is temporarily unavailable</h3><p>The ATS data plane could not initialize. Candidate and hiring mutations remain protected while the application shell stays online.</p></div></section> };
  }
}

export default async function RecruitingPage() {
  const state = await renderRecruiting();
  return (
    <AppShell>
      <section className="page-heading module-heading">
        <div><div className="eyebrow">HRBP One / Recruiting</div><h1>Recruiting</h1><p>Plan position-backed requisitions, govern candidate data, manage selection and convert accepted offers directly into employee records.</p></div>
        <div className="module-heading-actions">{state.degraded ? <button className="secondary-button" disabled><CircleAlert size={16}/> Protected fallback</button> : <button className="secondary-button" disabled><CircleCheckBig size={16}/> Governed live data</button>}</div>
      </section>
      {state.content}
    </AppShell>
  );
}
