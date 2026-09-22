import { CircleAlert, CircleCheckBig } from "lucide-react";
import { AppShell } from "@/components/app-shell";

const copy: Record<string, { title: string; description: string }> = {
  engagement: { title: "Engagement", description: "Run privacy-preserving employee listening with campaign-level anonymity thresholds and governed participation signals." },
  "workforce-planning": { title: "Workforce Planning", description: "Model future FTE, role, skill and cost scenarios without mutating the authoritative organization before approval." },
  analytics: { title: "People Analytics", description: "Deliver governed workforce metrics with semantic definitions, minimum-population thresholds and suppression before display." },
  "ai-assistant": { title: "AI Assistant", description: "Provide purpose-bound HR assistance with minimal-retention telemetry, explicit data boundaries and human-owned employment decisions." },
  privacy: { title: "Privacy & Compliance", description: "Operate RoPA, data-subject rights, DPIA signals and transfer safeguards from the same governed HR data plane." }
};

export async function GovernancePlanningModulePage({ slug }: { slug: "engagement" | "workforce-planning" | "analytics" | "ai-assistant" | "privacy" }) {
  const meta = copy[slug];
  try {
    const { GovernancePlanningLiveWorkspace } = await import("@/components/governance-planning-live-workspace");
    return <AppShell>
      <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="module-heading-actions"><button className="secondary-button" disabled><CircleCheckBig size={16}/> Governed workspace</button></div></section>
      {await GovernancePlanningLiveWorkspace({ slug })}
    </AppShell>;
  } catch (error) {
    console.error(`[HRBP] Dedicated governance-planning ${slug} workspace failed; using protected fallback.`, error);
    try {
      const { GovernancePlanningWorkspace } = await import("@/components/governance-planning-workspace");
      return <AppShell><section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="module-heading-actions"><button className="secondary-button" disabled><CircleAlert size={16}/> Protected fallback</button></div></section><GovernancePlanningWorkspace slug={slug}/></AppShell>;
    } catch (fallbackError) {
      console.error(`[HRBP] Governance-planning ${slug} fallback also failed.`, fallbackError);
      return <AppShell><section className="page-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div></section><section className="card module-table"><div className="empty-state"><CircleAlert size={24}/><h3>{meta.title} is temporarily unavailable</h3><p>The governed data plane could not initialize. No mutation was attempted.</p></div></section></AppShell>;
    }
  }
}
