import { CircleAlert, CircleCheckBig, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getServerLocale } from "@/lib/i18n-server";
import { getServerRequestContext } from "@/lib/server-session";

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
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  const state = await renderRecruiting();
  const tr = locale === "tr";
  return (
    <AppShell>
      <section className="page-heading module-heading">
        <div><div className="eyebrow">HRBP One / {tr ? "İşe Alım" : "Recruiting"}</div><h1>{tr ? "İşe Alım" : "Recruiting"}</h1><p>{tr ? "Pozisyona bağlı işe alım taleplerini planlayın, aday verisini yönetin, seçimi takip edin ve kabul edilen teklifleri kontrollü biçimde çalışan kaydına dönüştürün." : "Plan position-backed requisitions, govern candidate data, manage selection and convert accepted offers directly into employee records."}</p></div>
        <div className="module-heading-actions">{!ctx ? <button className="secondary-button" disabled><ShieldCheck size={16}/> {tr ? "Sentetik staging" : "Synthetic staging"}</button> : state.degraded ? <button className="secondary-button" disabled><CircleAlert size={16}/> {tr ? "Korumalı yedek mod" : "Protected fallback"}</button> : <button className="secondary-button" disabled><CircleCheckBig size={16}/> {tr ? "Yönetişimli canlı veri" : "Governed live data"}</button>}</div>
      </section>
      {state.content}
    </AppShell>
  );
}
