"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, HeartHandshake, ShieldCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { BenefitPlanGovernanceRow } from "@/lib/benefits-governance-data";

function dateOnly(value: string | null) { return value ? value.slice(0, 10) : ""; }

export function BenefitsGovernanceConsole({ plans }: { plans: BenefitPlanGovernanceRow[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function patch(key: string, id: string, payload: Record<string, unknown>) {
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(`/api/benefits/plans/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`, `İstek başarısız (${response.status})`));
      setNotice({ tone: "ok", text: c("Benefit plan governance record updated and audit evidence written.", "Yan hak planı yönetişim kaydı güncellendi ve denetim kanıtı yazıldı.") });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Transaction failed.", "İşlem başarısız.") });
    } finally {
      setPending(null);
    }
  }

  return <section className="performance-console card growth-lifecycle-console">
    <div className="performance-console-head">
      <div><span className="section-kicker">{c("Benefits governance", "Yan hak yönetişimi")}</span><h3>{c("Effective-dated plan lifecycle", "Tarih-etkin plan yaşam döngüsü")}</h3><p>{c("Maintain provider, contribution and effective-period metadata while preserving enrollment history. Deactivation blocks new elections without deleting historical coverage.", "Kayıt geçmişini koruyarak sağlayıcı, katkı ve geçerlilik dönemi bilgilerini yönetin. Pasife alma tarihsel kapsamı silmeden yeni seçimleri engeller.")}</p></div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("History preserved", "Geçmiş korunuyor")}</span></div>
    </div>

    {notice ? <div className={`performance-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}

    <div className="growth-lifecycle-list">{plans.length ? plans.map((plan) => <form className="growth-lifecycle-row" key={plan.id} onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void patch(`plan-${plan.id}`, plan.id, {
        name: data.get("name"),
        provider: data.get("provider") || null,
        countryCode: data.get("countryCode") || null,
        currency: data.get("currency") || null,
        employerContribution: data.get("employerContribution") || null,
        employeeContribution: data.get("employeeContribution") || null,
        effectiveTo: data.get("effectiveTo") || null
      });
    }}>
      <div className="growth-lifecycle-icon"><HeartHandshake size={16}/></div>
      <div className="growth-lifecycle-copy"><strong>{plan.code} · {plan.name}</strong><small>{plan.type} · {plan.enrollments} {c("enrollments", "kayıt")} · {plan.activeEnrollments} {c("active", "aktif")} · {plan.pendingEnrollments} {c("pending", "bekleyen")}</small><span>{dateOnly(plan.effectiveFrom)} → {dateOnly(plan.effectiveTo) || "—"} · {plan.active ? c("Active catalog", "Aktif katalog") : c("Inactive catalog", "Pasif katalog")}</span></div>
      <div className="performance-review-controls"><input name="name" defaultValue={plan.name} maxLength={250}/><input name="provider" defaultValue={plan.provider ?? ""} maxLength={250} placeholder={c("Provider", "Sağlayıcı")}/><input name="countryCode" defaultValue={plan.countryCode ?? ""} maxLength={2} placeholder="TR"/><input name="currency" defaultValue={plan.currency ?? ""} maxLength={3} placeholder="TRY"/><input name="employerContribution" type="number" min="0" step="0.01" defaultValue={plan.employerContribution ?? ""} placeholder={c("Employer contribution", "İşveren katkısı")}/><input name="employeeContribution" type="number" min="0" step="0.01" defaultValue={plan.employeeContribution ?? ""} placeholder={c("Employee contribution", "Çalışan katkısı")}/><input name="effectiveTo" type="date" min={dateOnly(plan.effectiveFrom)} defaultValue={dateOnly(plan.effectiveTo)}/><button className="secondary-button" disabled={pending !== null}>{pending === `plan-${plan.id}` ? "…" : c("Save", "Kaydet")}</button><button className="secondary-button" type="button" disabled={pending !== null} onClick={() => void patch(`plan-state-${plan.id}`, plan.id, { active: !plan.active })}>{pending === `plan-state-${plan.id}` ? "…" : plan.active ? c("Deactivate", "Pasife al") : c("Reactivate", "Etkinleştir")}</button></div>
    </form>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No benefit plans are configured.", "Yan hak planı yapılandırılmamış.")}</span></div>}</div>
  </section>;
}
