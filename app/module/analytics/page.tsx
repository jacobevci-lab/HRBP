import { ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AnalyticsModulePage } from "@/components/analytics-module-page";
import { GovernancePlanningWorkspace } from "@/components/governance-planning-workspace";
import { getServerLocale } from "@/lib/i18n-server";
import { getServerRequestContext } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AnalyticsPage() {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (ctx) return <AppShell><AnalyticsModulePage/></AppShell>;

  const tr = locale === "tr";
  return <AppShell>
    <section className="page-heading module-heading">
      <div><div className="eyebrow">HRBP One / {tr ? "Analitik" : "Analytics"}</div><h1>{tr ? "Analitik" : "Analytics"}</h1><p>{tr ? "Gizlilik eşikleri ve yönetişimli metrik sözleşmeleriyle iş gücü analitiğini örnek staging verisi üzerinden inceleyin." : "Explore workforce analytics with privacy thresholds and governed metric contracts using sample staging data."}</p></div>
      <div className="module-heading-actions"><button className="secondary-button" disabled><ShieldCheck size={16}/> {tr ? "Salt-okunur staging önizlemesi" : "Read-only staging preview"}</button></div>
    </section>
    <section className="card module-degraded-banner" style={{ marginBottom: 14, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}><ShieldCheck size={18} style={{ flex: "0 0 auto", marginTop: 1 }}/><div><strong style={{ display: "block", fontSize: 11 }}>{tr ? "Güvenli demo verisi" : "Safe demo data"}</strong><p style={{ margin: "3px 0 0", fontSize: 9.5, lineHeight: 1.5 }}>{tr ? "Bu görünüm yalnızca sentetik metrikler kullanır. Canlı çalışan popülasyonu, özel analitik snapshot'ları ve yenileme işlemleri yetkili giriş gerektirir." : "This view uses synthetic metrics only. Live workforce populations, private analytics snapshots and refresh actions require an authorized sign-in."}</p></div></section>
    <GovernancePlanningWorkspace slug="analytics"/>
  </AppShell>;
}
