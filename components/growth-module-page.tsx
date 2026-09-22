import { CircleAlert, CircleCheckBig } from "lucide-react";
import { AppShell } from "@/components/app-shell";

const copy: Record<string, { title: string; description: string }> = {
  benefits: { title: "Benefits", description: "Administer effective-dated plans and employee coverage without losing payroll or historical traceability." },
  performance: { title: "Performance", description: "Run goals, reviews and calibration with human-owned ratings and auditable decision evidence." },
  talent: { title: "Talent", description: "Review performance and potential using explicit human assessments instead of opaque employee scoring." },
  succession: { title: "Succession", description: "Protect critical-role continuity with successor readiness, coverage gaps and review ownership." },
  learning: { title: "Skills & Learning", description: "Manage learning compliance, critical skills and development signals on the same employment graph." }
};

export async function GrowthModulePage({ slug }: { slug: "benefits" | "performance" | "talent" | "succession" | "learning" }) {
  const meta = copy[slug];
  try {
    const { GrowthLiveWorkspace } = await import("@/components/growth-live-workspace");
    return <AppShell>
      <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="module-heading-actions"><button className="secondary-button" disabled><CircleCheckBig size={16}/> Governed workspace</button></div></section>
      {await GrowthLiveWorkspace({ slug })}
    </AppShell>;
  } catch (error) {
    console.error(`[HRBP] Dedicated ${slug} workspace failed; using protected fallback.`, error);
    try {
      const { GrowthWorkspace } = await import("@/components/growth-workspace");
      return <AppShell><section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="module-heading-actions"><button className="secondary-button" disabled><CircleAlert size={16}/> Protected fallback</button></div></section><GrowthWorkspace slug={slug}/></AppShell>;
    } catch (fallbackError) {
      console.error(`[HRBP] ${slug} fallback also failed.`, fallbackError);
      return <AppShell><section className="page-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div></section><section className="card module-table"><div className="empty-state"><CircleAlert size={24}/><h3>{meta.title} is temporarily unavailable</h3><p>The governed data plane could not initialize. No mutation was attempted.</p></div></section></AppShell>;
    }
  }
}
