import { CircleAlert, CircleCheckBig } from "lucide-react";
import { AppShell } from "@/components/app-shell";

const copy = {
  "time-attendance": { title: "Time & Attendance", description: "Operate governed schedules, attendance, overtime, exceptions and payroll-ready time from relationship-scoped employment data." },
  leave: { title: "Leave", description: "Manage leave requests, balances and approvals without disconnecting policy, employment scope or audit evidence." },
  compensation: { title: "Compensation", description: "Run restricted effective-dated compensation changes with approval separation and immutable salary history." },
  payroll: { title: "Payroll", description: "Operate restricted country-pack payroll periods, controlled run states and auditable results from the HR system of record." }
} as const;

type Slug = keyof typeof copy;

export async function WorkPayModulePage({ slug }: { slug: Slug }) {
  const meta = copy[slug];
  try {
    const content = slug === "compensation"
      ? await (await import("@/components/compensation-live-workspace")).CompensationLiveWorkspace()
      : await (await import("@/components/work-pay-live-workspace")).WorkPayLiveWorkspace({ slug });

    return <AppShell>
      <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="module-heading-actions"><button className="secondary-button" disabled><CircleCheckBig size={16}/> Governed workspace</button></div></section>
      {content}
    </AppShell>;
  } catch (error) {
    console.error(`[HRBP] Dedicated ${slug} workspace failed; using protected fallback.`, error);
    try {
      const { WorkPayWorkspace } = await import("@/components/work-pay-workspace");
      return <AppShell><section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="module-heading-actions"><button className="secondary-button" disabled><CircleAlert size={16}/> Protected fallback</button></div></section><WorkPayWorkspace slug={slug}/></AppShell>;
    } catch (fallbackError) {
      console.error(`[HRBP] ${slug} fallback also failed.`, fallbackError);
      return <AppShell><section className="page-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div></section><section className="card module-table"><div className="empty-state"><CircleAlert size={24}/><h3>{meta.title} is temporarily unavailable</h3><p>The governed data plane could not initialize. No mutation was attempted.</p></div></section></AppShell>;
    }
  }
}
