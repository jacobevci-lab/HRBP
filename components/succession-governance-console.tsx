"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BookOpenCheck, CheckCircle2, CircleAlert, Clock3, ShieldCheck, Sparkles, Trash2, UsersRound } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { SuccessionGovernanceData } from "@/lib/succession-governance-data";

const readinessValues = ["READY_NOW", "READY_LT_1_YEAR", "READY_1_2_YEARS", "READY_2_PLUS_YEARS"];
const proficiencyValues = ["AWARENESS", "FOUNDATION", "PRACTITIONER", "ADVANCED", "EXPERT"];

function label(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = {
    READY_NOW: "Şimdi hazır",
    READY_LT_1_YEAR: "1 yıldan kısa",
    READY_1_2_YEARS: "1-2 yıl",
    READY_2_PLUS_YEARS: "2+ yıl",
    NEEDS_IMPROVEMENT: "Gelişim gerekli",
    DEVELOPING: "Gelişiyor",
    MEETS: "Beklentiyi karşılıyor",
    EXCEEDS: "Beklentiyi aşıyor",
    OUTSTANDING: "Üstün",
    LIMITED: "Sınırlı",
    MODERATE: "Orta",
    HIGH: "Yüksek",
    AWARENESS: "Farkındalık",
    FOUNDATION: "Temel",
    PRACTITIONER: "Uygulayıcı",
    ADVANCED: "İleri",
    EXPERT: "Uzman",
    ASSIGNED: "Atandı",
    IN_PROGRESS: "Devam ediyor",
    COMPLETED: "Tamamlandı",
    OVERDUE: "Gecikmiş",
    WAIVED: "Muaf"
  };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function dateOnly(value: string | null) { return value ? value.slice(0, 10) : ""; }

export function SuccessionGovernanceConsole({ plans, courses, skills, allowLearningPlan }: SuccessionGovernanceData & { allowLearningPlan: boolean }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function mutate(key: string, url: string, method: "POST" | "PATCH" | "DELETE", payload?: Record<string, unknown>) {
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
        <h3>{c("Talent signal → development → readiness", "Yetenek sinyali → gelişim → hazırlık")}</h3>
        <p>{c("Review the latest human-owned talent assessment, connect development gaps to governed learning and reassess successor readiness after evidence arrives. Learning completion never changes readiness automatically.", "En güncel insan sahipli yetenek değerlendirmesini inceleyin, gelişim açıklarını yönetişimli eğitime bağlayın ve kanıt geldikten sonra aday hazırlığını yeniden değerlendirin. Eğitim tamamlanması hazırlık seviyesini hiçbir zaman otomatik değiştirmez.")}</p>
      </div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Human decision boundary", "İnsan karar sınırı")}</span></div>
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

      {plan.active && plan.candidates.length ? <div className="growth-lifecycle-list">{plan.candidates.map((candidate) => <Fragment key={candidate.id}>
        <form className="growth-lifecycle-row" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void mutate(`candidate-${candidate.id}`, `/api/succession/candidates/${candidate.id}`, "PATCH", {
            readiness: data.get("readiness"),
            rank: data.get("rank") || null,
            developmentGap: data.get("developmentGap") || null
          });
        }}>
          <div className="growth-lifecycle-icon">{candidate.readiness === "READY_NOW" ? <CheckCircle2 size={16}/> : <AlertTriangle size={16}/>}</div>
          <div className="growth-lifecycle-copy">
            <strong>{candidate.person}</strong>
            <small>{candidate.employeeNumber} · {candidate.position}</small>
            <span>{candidate.developmentGap || c("No development gap recorded", "Gelişim açığı kaydedilmemiş")}</span>
            {candidate.latestTalent ? <span><Sparkles size={11}/> {candidate.latestTalent.cycleLabel} · {label(candidate.latestTalent.performance, locale)} / {label(candidate.latestTalent.potential, locale)}{candidate.latestTalent.criticalTalent ? ` · ${c("Critical talent", "Kritik yetenek")}` : ""}</span> : <span>{c("No governed talent assessment linked", "Bağlı yönetişimli yetenek değerlendirmesi yok")}</span>}
          </div>
          <div className="performance-review-controls"><select name="readiness" defaultValue={candidate.readiness}>{readinessValues.map((value) => <option key={value} value={value}>{label(value, locale)}</option>)}</select><input name="rank" type="number" min="1" max="99" placeholder={c("Rank", "Sıra")} defaultValue={candidate.rank ?? ""}/><input name="developmentGap" maxLength={2000} placeholder={c("Development gap", "Gelişim açığı")} defaultValue={candidate.developmentGap ?? ""}/><button className="secondary-button" disabled={pending !== null}>{pending === `candidate-${candidate.id}` ? "…" : c("Save", "Kaydet")}</button><button className="secondary-button" type="button" disabled={pending !== null} onClick={() => {
            if (window.confirm(c("Remove this successor candidate from the active plan?", "Bu yedek adayı aktif plandan çıkarmak istiyor musunuz?"))) void mutate(`remove-${candidate.id}`, `/api/succession/candidates/${candidate.id}`, "DELETE");
          }}><Trash2 size={14}/>{pending === `remove-${candidate.id}` ? "…" : c("Remove", "Çıkar")}</button></div>
        </form>

        {candidate.developmentAssignments.length ? <div className="performance-operation" style={{ marginLeft: 28 }}>
          <div className="performance-operation-main"><strong><BookOpenCheck size={14}/> {c("Connected development evidence", "Bağlı gelişim kanıtı")}</strong><small>{c("Learning status and assessed proficiency are evidence for the next human readiness review.", "Eğitim durumu ve değerlendirilmiş yetkinlik seviyesi bir sonraki insan hazırlık incelemesi için kanıttır.")}</small></div>
          <div className="growth-lifecycle-list">{candidate.developmentAssignments.map((assignment) => <div className="growth-lifecycle-row" key={assignment.id}>
            <div className="growth-lifecycle-icon"><BookOpenCheck size={15}/></div>
            <div className="growth-lifecycle-copy"><strong>{assignment.courseCode} · {assignment.courseTitle}</strong><small>{assignment.skillCode} · {assignment.skillName}</small><span>{c("Proficiency", "Yetkinlik")}: {assignment.currentProficiency ? label(assignment.currentProficiency, locale) : c("Not assessed", "Değerlendirilmemiş")} → {assignment.targetProficiency ? label(assignment.targetProficiency, locale) : c("No target", "Hedef yok")} · {assignment.dueAt ? `${c("Due", "Son tarih")} ${dateOnly(assignment.dueAt)}` : c("No due date", "Son tarih yok")}</span></div>
            <em className={`growth-pill ${assignment.status.toLowerCase().replaceAll("_", "-")}`}>{label(assignment.status, locale)}</em>
          </div>)}</div>
        </div> : null}

        {allowLearningPlan ? <form className="performance-operation review-operation" style={{ marginLeft: 28 }} onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void mutate(`development-${candidate.id}`, `/api/succession/candidates/${candidate.id}/development-assignment`, "POST", {
            courseId: data.get("courseId"),
            skillId: data.get("skillId"),
            targetProficiency: data.get("targetProficiency"),
            dueAt: data.get("dueAt")
          });
        }}>
          <div className="performance-operation-main"><strong><BookOpenCheck size={14}/> {c("Create governed development assignment", "Yönetişimli gelişim ataması oluştur")}</strong><small>{c("Select a course and skill target. Completion will notify the succession owner for human reassessment; it will not auto-promote readiness.", "Eğitim ve yetkinlik hedefi seçin. Tamamlanması yedekleme sahibine insan değerlendirmesi bildirimi gönderir; hazırlık seviyesini otomatik yükseltmez.")}</small></div>
          <div className="performance-review-controls"><select name="courseId" required defaultValue=""><option value="" disabled>{c("Course", "Eğitim")}</option>{courses.map((course) => <option value={course.id} key={course.id}>{course.code} · {course.title}</option>)}</select><select name="skillId" required defaultValue=""><option value="" disabled>{c("Development skill", "Gelişim yetkinliği")}</option>{skills.map((skill) => <option value={skill.id} key={skill.id}>{skill.code} · {skill.name}{skill.critical ? ` · ${c("Critical", "Kritik")}` : ""}</option>)}</select><select name="targetProficiency" required defaultValue="ADVANCED">{proficiencyValues.map((value) => <option value={value} key={value}>{label(value, locale)}</option>)}</select><input name="dueAt" type="date" required/><button className="secondary-button" disabled={pending !== null || !courses.length || !skills.length}>{pending === `development-${candidate.id}` ? "…" : c("Assign development", "Gelişim ata")}</button></div>
        </form> : null}
      </Fragment>)}</div> : <div className="growth-lifecycle-empty"><CircleAlert size={18}/><span>{plan.active ? c("No successor candidate is assigned to this plan.", "Bu plana atanmış yedek aday yok.") : c("Plan is inactive; candidate changes are locked.", "Plan pasif; aday değişiklikleri kilitli.")}</span></div>}
    </article>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No succession plans are available in your authorized scope.", "Yetkili kapsamınızda yedekleme planı yok.")}</span></div>}</div>
  </section>;
}
