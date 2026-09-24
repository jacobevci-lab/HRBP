import { CircleAlert, CircleCheckBig, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getServerLocale } from "@/lib/i18n-server";
import { getServerRequestContext } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function renderOffboarding() {
  try {
    const { OffboardingWorkspace } = await import("@/components/offboarding-workspace");
    return { degraded: false, content: await OffboardingWorkspace() };
  } catch (error) {
    console.error("[HRBP] Dedicated Offboarding workspace failed.", error);
    return {
      degraded: true,
      content: <section className="card module-table"><div className="empty-state"><h3>Offboarding is temporarily unavailable</h3><p>The separation data plane could not initialize. No employee exit mutation was attempted.</p></div></section>
    };
  }
}

export default async function OffboardingPage() {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  const state = await renderOffboarding();
  const tr = locale === "tr";
  return <AppShell>
    <section className="page-heading module-heading">
      <div><div className="eyebrow">HRBP One / {tr ? "İşten Ayrılış" : "Offboarding"}</div><h1>{tr ? "İşten Ayrılış" : "Offboarding"}</h1><p>{tr ? "İstihdam kaydı kapanmadan önce çalışan ayrılışlarını İK, yönetici, kimlik, varlık ve bordro kontrolleriyle uçtan uca yönetin." : "Orchestrate controlled employee exits across HR, managers, identity, assets and payroll before the employment record can close."}</p></div>
      <div className="module-heading-actions">{!ctx ? <button className="secondary-button" disabled><ShieldCheck size={16}/> {tr ? "Sentetik staging" : "Synthetic staging"}</button> : state.degraded ? <button className="secondary-button" disabled><CircleAlert size={16}/> {tr ? "Korumalı yedek mod" : "Protected fallback"}</button> : <button className="secondary-button" disabled><CircleCheckBig size={16}/> {tr ? "Yönetişimli ayrılış akışı" : "Governed exit workflow"}</button>}</div>
    </section>
    {state.content}
  </AppShell>;
}
