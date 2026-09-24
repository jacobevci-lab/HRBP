"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Clock3, GraduationCap, HeartHandshake, ShieldCheck, Sparkles } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { BenefitEnrollmentOperation, LearningAssignmentOperation } from "@/lib/growth-lifecycle-data";

type Props =
  | { slug: "benefits"; enrollments: BenefitEnrollmentOperation[]; assignments?: never }
  | { slug: "learning"; assignments: LearningAssignmentOperation[]; enrollments?: never };

const benefitTransitions: Record<string, string[]> = {
  PENDING: ["ACTIVE", "WAIVED", "ENDED"],
  ACTIVE: ["SUSPENDED", "ENDED"],
  SUSPENDED: ["ACTIVE", "ENDED"]
};
const learningTransitions: Record<string, string[]> = {
  ASSIGNED: ["IN_PROGRESS", "OVERDUE", "WAIVED"],
  IN_PROGRESS: ["COMPLETED", "OVERDUE", "WAIVED"],
  OVERDUE: ["IN_PROGRESS", "COMPLETED", "WAIVED"]
};

function label(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = {
    PENDING: "Bekliyor", ACTIVE: "Aktif", WAIVED: "Muaf", SUSPENDED: "Askıda", ENDED: "Sona erdi",
    ASSIGNED: "Atandı", IN_PROGRESS: "Devam ediyor", COMPLETED: "Tamamlandı", OVERDUE: "Gecikmiş",
    AWARENESS: "Farkındalık", FOUNDATION: "Temel", PRACTITIONER: "Uygulayıcı", ADVANCED: "İleri", EXPERT: "Uzman"
  };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function dateOnly(value: string | null) { return value ? value.slice(0, 10) : "—"; }
function inputDate(value: string | null) { return value ? value.slice(0, 10) : ""; }

export function GrowthLifecycleConsole(props: Props) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function request(key: string, url: string, method: "POST" | "PATCH", payload: Record<string, unknown>, successText?: string) {
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(url, { method, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`, `İstek başarısız (${response.status})`));
      setNotice({ tone: "ok", text: successText ?? c("Lifecycle transition completed and audit evidence written.", "Yaşam döngüsü geçişi tamamlandı ve denetim kanıtı yazıldı.") });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Transaction failed.", "İşlem başarısız.") });
    } finally {
      setPending(null);
    }
  }

  return <section className="performance-console card growth-lifecycle-console">
    <div className="performance-console-head">
      <div><span className="section-kicker">{props.slug === "benefits" ? c("Enrollment lifecycle", "Kayıt yaşam döngüsü") : c("Learning execution", "Eğitim yürütme")}</span><h3>{props.slug === "benefits" ? c("Governed benefit elections", "Yönetişimli yan hak seçimleri") : c("Governed learning assignments", "Yönetişimli eğitim atamaları")}</h3><p>{props.slug === "benefits" ? c("Amend pending elections, then approve, suspend, waive or end coverage without overwriting governed history.", "Bekleyen seçimleri düzeltin; ardından yönetişimli geçmişi ezmeden kapsamı etkinleştirin, askıya alın, muaf tutun veya sonlandırın.") : c("Move learning obligations through explicit assignment states and retain completion evidence. Development-plan and succession-linked items keep their provenance and require later human reassessment.", "Eğitim yükümlülüklerini açık atama durumlarından ilerletin ve tamamlama kanıtını koruyun. Gelişim planı ve yedeklemeye bağlı kayıtlar kaynak bağlamını korur ve sonrasında insan değerlendirmesi gerektirir.")}</p></div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Lifecycle controls active", "Yaşam döngüsü kontrolleri aktif")}</span></div>
    </div>
    {notice ? <div className={`performance-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}
    {props.slug === "benefits" ? <BenefitQueue rows={props.enrollments}/> : <LearningQueue rows={props.assignments}/>}
  </section>;

  function BenefitQueue({ rows }: { rows: BenefitEnrollmentOperation[] }) {
    return <div className="growth-lifecycle-list">{rows.length ? rows.map((row) => <article className="growth-lifecycle-row" key={row.id}>
      <div className="growth-lifecycle-icon"><HeartHandshake size={16}/></div>
      <div className="growth-lifecycle-copy"><strong>{row.person}</strong><small>{row.employeeNumber} · {row.planCode} · {row.plan}</small><span>{c("Coverage", "Kapsam")}: {row.coverageTier} · {dateOnly(row.effectiveFrom)} → {dateOnly(row.effectiveTo)}</span></div>
      <em className={`growth-pill ${row.status.toLowerCase().replaceAll("_", "-")}`}>{label(row.status, locale)}</em>
      <div className="growth-lifecycle-actions">
        {row.status === "PENDING" ? <form className="performance-review-controls" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void request(`benefit-amend-${row.id}`, `/api/benefits/enrollments/${row.id}`, "PATCH", {
            coverageTier: data.get("coverageTier") || null,
            employerContribution: data.get("employerContribution") || null,
            employeeContribution: data.get("employeeContribution") || null,
            effectiveFrom: data.get("effectiveFrom"),
            effectiveTo: data.get("effectiveTo") || null
          }, c("Pending benefit election amended and audit evidence written.", "Bekleyen yan hak seçimi düzeltildi ve denetim kanıtı yazıldı."));
        }}>
          <input name="coverageTier" maxLength={120} defaultValue={row.coverageTier === "—" ? "" : row.coverageTier} placeholder={c("Coverage tier", "Kapsam seviyesi")}/>
          <input name="employerContribution" type="number" min="0" step="0.01" defaultValue={row.employerContribution ?? ""} placeholder={c("Employer contribution", "İşveren katkısı")}/>
          <input name="employeeContribution" type="number" min="0" step="0.01" defaultValue={row.employeeContribution ?? ""} placeholder={c("Employee contribution", "Çalışan katkısı")}/>
          <input name="effectiveFrom" type="date" required min={inputDate(row.planEffectiveFrom)} max={inputDate(row.planEffectiveTo) || undefined} defaultValue={inputDate(row.effectiveFrom)}/>
          <input name="effectiveTo" type="date" min={inputDate(row.effectiveFrom)} max={inputDate(row.planEffectiveTo) || undefined} defaultValue={inputDate(row.effectiveTo)}/>
          <button className="secondary-button" disabled={pending !== null}>{pending === `benefit-amend-${row.id}` ? "…" : c("Save pending election", "Bekleyen seçimi kaydet")}</button>
        </form> : null}
        {(benefitTransitions[row.status] ?? []).map((next) => <button className="secondary-button" type="button" key={next} disabled={pending !== null} onClick={() => void request(`benefit-${row.id}-${next}`, `/api/benefits/enrollments/${row.id}/transition`, "POST", { status: next })}>{pending === `benefit-${row.id}-${next}` ? "…" : label(next, locale)}</button>)}
      </div>
    </article>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No active benefit elections require lifecycle action.", "Yaşam döngüsü aksiyonu gerektiren aktif yan hak seçimi yok.")}</span></div>}</div>;
  }

  function LearningQueue({ rows }: { rows: LearningAssignmentOperation[] }) {
    return <div className="growth-lifecycle-list">{rows.length ? rows.map((row) => <article className="growth-lifecycle-row" key={row.id}>
      <div className="growth-lifecycle-icon"><GraduationCap size={16}/></div>
      <div className="growth-lifecycle-copy"><strong>{row.person}</strong><small>{row.employeeNumber} · {row.courseCode} · {row.course}</small><span>{row.mandatory ? c("Mandatory", "Zorunlu") : c("Development", "Gelişim")} · <Clock3 size={11}/> {c("Due", "Son tarih")} {dateOnly(row.dueAt)}</span>{row.developmentPlanTitle && row.developmentSkillName ? <span><Sparkles size={11}/> {c("Development plan", "Gelişim planı")}: {row.developmentPlanTitle} · {row.developmentSkillCode} · {row.developmentSkillName}{row.targetProficiency ? ` → ${label(row.targetProficiency, locale)}` : ""}{row.successionCandidateId ? ` · ${c("succession-linked", "yedeklemeye bağlı")}` : ""}</span> : row.successionCandidateId && row.developmentSkillName ? <span><Sparkles size={11}/> {c("Succession development", "Yedekleme gelişimi")} · {row.developmentSkillCode} · {row.developmentSkillName}{row.targetProficiency ? ` → ${label(row.targetProficiency, locale)}` : ""}</span> : null}</div>
      <em className={`growth-pill ${row.status.toLowerCase().replaceAll("_", "-")}`}>{label(row.status, locale)}</em>
      <div className="growth-lifecycle-actions">{(learningTransitions[row.status] ?? []).map((next) => <button className="secondary-button" type="button" key={next} disabled={pending !== null} onClick={() => void request(`learning-${row.id}-${next}`, `/api/learning/assignments/${row.id}/transition`, "POST", { status: next })}>{pending === `learning-${row.id}-${next}` ? "…" : label(next, locale)}</button>)}</div>
    </article>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No open learning assignments require action.", "Aksiyon gerektiren açık eğitim ataması yok.")}</span></div>}</div>;
  }
}
