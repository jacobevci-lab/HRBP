"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleAlert, Clock3, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { SuccessionPlanOperation } from "@/lib/succession-governance-data";

const readinessValues = ["READY_NOW", "READY_LT_1_YEAR", "READY_1_2_YEARS", "READY_2_PLUS_YEARS"];

function label(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = {
    READY_NOW: "Şimdi hazır",
    READY_LT_1_YEAR: "1 yıldan kısa",
    READY_1_2_YEARS: "1-2 yıl",
    READY_2_PLUS_YEARS: "2+ yıl"
  };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function dateOnly(value: string | null) { return value ? value.slice(0, 10) : ""; }

export function SuccessionGovernanceConsole({ plans }: { plans: SuccessionPlanOperation[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function mutate(key: string, url: string, method: "PATCH" | "DELETE", payload?: Record<string, unknown>) {
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: payload ? { "content-type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`, `İstek başarısız (${response.status})`));
      setNotice({ tone: "ok", text: c("Succession governance record updated and audit evidence written.", "Yedekleme yönetişim kaydı güncellendi ve denetim kanıtı yazıldı.") });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Transaction failed.", "İşlem başarısız.") });
    } finally {
      setPending(null);
    }
  }

  return <section className="performance-console card growth-lifecycle-console">
    <div className="performance-console-head">
      <div>
        <span className="section-kicker">{c("Succession governance", "Yedekleme yönetişimi")}</span>
        <h3>{c("Plan review & successor readiness", "Plan inceleme ve aday hazırlığı")}</h3>
        <p>{c("Refresh review dates, activate or retire plans, maintain successor readiness and preserve rank integrity without deleting historical plan context.", "İnceleme tarihlerini yenileyin, planları etkinleştirin veya pasife alın, aday hazırlığını yönetin ve tarihsel plan bağlamını silmeden sıralama bütünlüğünü koruyun.")}</p>
      </div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Relationship scope enforced", "İlişki kapsamı zorunlu")}</span></div>
    </div>

    {notice ? <div className={`performance-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}

    <div className="growth-lifecycle-list">{plans.length ? plans.map((plan) => <article className="performance-ops-panel" key={plan.id}>
      <div className="performance-panel-title">
        <UsersRound size={16}/>
        <div><strong>{plan.position}</strong><small>{plan.positionCode} · {plan.organization} · {plan.candidates.length} {c("candidates", "aday")}</small></div>
        <em className={`growth-pill ${plan.active ? plan.overdue ? "overdue" : "active" : "cancelled"}`}>{plan.active ? plan.overdue ? c("Review overdue", "İnceleme gecikmiş") : c("Active", "Aktif") : c("Inactive", "Pasif")}</em>
      </div>

      <form className="performance-operation review-operation" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void mutate(`plan-${plan.id}`, `/api/succession/plans/${plan.id}`, "PATCH", { reviewDueAt: data.get("reviewDueAt") || null });
      }}>
        <div className="performance-operation-main"><strong>{plan.critical ? c("Critical position", "Kritik pozisyon") : c("Succession plan", "Yedekleme planı")}</strong><small><Clock3 size={11}/> {plan.reviewDueAt ? `${c("Review due", "İnceleme tarihi")}: ${dateOnly(plan.reviewDueAt)}` : c("No review date set", "İnceleme tarihi belirlenmemiş")}</small></div>
        <div className="performance-review-controls"><input name="reviewDueAt" type="date" defaultValue={dateOnly(plan.reviewDueAt)}/><button className="secondary-button" disabled={pending !== null}>{pending === `plan-${plan.id}` ? "…" : c("Save review date", "İnceleme tarihini kaydet")}</button><button className="secondary-button" type="button" disabled={pending !== null} onClick={() => void mutate(`plan-state-${plan.id}`, `/api/succession/plans/${plan.id}`, "PATCH", { active: !plan.active })}>{pending === `plan-state-${plan.id}` ? "…" : plan.active ? c("Deactivate", "Pasife al") : c("Reactivate", "Yeniden etkinleştir")}</button></div>
      </form>

      {plan.active && plan.candidates.length ? <div className="growth-lifecycle-list">{plan.candidates.map((candidate) => <form className="growth-lifecycle-row" key={candidate.id} onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void mutate(`candidate-${candidate.id}`, `/api/succession/candidates/${candidate.id}`, "PATCH", {
          readiness: data.get("readiness"),
          rank: data.get("rank") || null,
          developmentGap: data.get("developmentGap") || null
        });
      }}>
        <div className="growth-lifecycle-icon">{candidate.readiness === "READY_NOW" ? <CheckCircle2 size={16}/> : <AlertTriangle size={16}/>}</div>
        <div className="growth-lifecycle-copy"><strong>{candidate.person}</strong><small>{candidate.employeeNumber} · {candidate.position}</small><span>{candidate.developmentGap || c("No development gap recorded", "Gelişim açığı kaydedilmemiş")}</span></div>
        <div className="performance-review-controls"><select name="readiness" defaultValue={candidate.readiness}>{readinessValues.map((value) => <option key={value} value={value}>{label(value, locale)}</option>)}</select><input name="rank" type="number" min="1" max="99" placeholder={c("Rank", "Sıra")} defaultValue={candidate.rank ?? ""}/><input name="developmentGap" maxLength={2000} placeholder={c("Development gap", "Gelişim açığı")} defaultValue={candidate.developmentGap ?? ""}/><button className="secondary-button" disabled={pending !== null}>{pending === `candidate-${candidate.id}` ? "…" : c("Save", "Kaydet")}</button><button className="secondary-button" type="button" disabled={pending !== null} onClick={() => {
          if (window.confirm(c("Remove this successor candidate from the active plan?", "Bu yedek adayı aktif plandan çıkarmak istiyor musunuz?"))) void mutate(`remove-${candidate.id}`, `/api/succession/candidates/${candidate.id}`, "DELETE");
        }}><Trash2 size={14}/>{pending === `remove-${candidate.id}` ? "…" : c("Remove", "Çıkar")}</button></div>
      </form>)}</div> : <div className="growth-lifecycle-empty"><CircleAlert size={18}/><span>{plan.active ? c("No successor candidate is assigned to this plan.", "Bu plana atanmış yedek aday yok.") : c("Plan is inactive; candidate changes are locked.", "Plan pasif; aday değişiklikleri kilitli.")}</span></div>}
    </article>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No succession plans are available in your authorized scope.", "Yetkili kapsamınızda yedekleme planı yok.")}</span></div>}</div>
  </section>;
}
