"use client";

import { Fragment, useEffect, useState } from "react";
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
  const focusCandidateId = plans.flatMap((plan) => plan.candidates).find((candidate) => candidate.focused)?.id;

  useEffect(() => {
    if (!focusCandidateId) return;
    document.getElementById(`succession-candidate-${focusCandidateId}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusCandidateId]);

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

      <form className="performance-operation review-operation" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void mutate(`plan-review-${plan.id}`, `/api/succession/plans/${plan.id}/review`, "POST", {
          summary: data.get("summary"),
          nextReviewDueAt: data.get("nextReviewDueAt"),
          expectedUpdatedAt: plan.updatedAt
        });
      }}>
        <div className="performance-operation-main">
          <strong>{c("Governed succession review", "Yönetişimli yedekleme incelemesi")}</strong>
          <small>{plan.lastReviewedAt
            ? c(`Last attested ${dateOnly(plan.lastReviewedAt)} by ${plan.lastReviewedBy ?? "governed reviewer"}`, `Son onaylı inceleme ${dateOnly(plan.lastReviewedAt)} · ${plan.lastReviewedBy ?? "yönetişimli inceleyen"}`)
            : c("No attested human review has been recorded yet.", "Henüz onaylı insan incelemesi kaydedilmedi.")}</small>
          {plan.lastReviewSummary ? <span>{plan.lastReviewSummary}</span> : null}
        </div>
        {plan.active ? <div className="performance-review-controls">
          <textarea name="summary" required minLength={12} maxLength={2000} placeholder={c("Review summary (12–2000 characters)", "İnceleme özeti (12–2000 karakter)")}/>
          <input name="nextReviewDueAt" type="date" required aria-label={c("Next review date", "Sonraki inceleme tarihi")}/>
          <button className="secondary-button" disabled={pending !== null}>{pending === `plan-review-${plan.id}` ? "…" : c("Complete review", "İncelemeyi tamamla")}</button>
        </div> : <div className="performance-finalized"><CircleAlert size={14}/>{c("Reactivate the plan before attesting a new review.", "Yeni incelemeyi onaylamadan önce planı yeniden etkinleştirin.")}</div>}
      </form>

      {plan.active && plan.candidates.length ? <div className="growth-lifecycle-list">{plan.candidates.map((candidate) => <Fragment key={candidate.id}>
        <form id={`succession-candidate-${candidate.id}`} className={`growth-lifecycle-row${candidate.focused ? " focused" : ""}`} onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void mutate(`candidate-${candidate.id}`, `/api/succession/candidates/${candidate.id}`, "PATCH", {
            readiness: data.get("readiness"),
            readinessReason: data.get("readinessReason") || undefined,
            rank: data.get("rank") || null,
            developmentGap: data.get("developmentGap") || null,
            expectedUpdatedAt: candidate.updatedAt
          });
        }}>
          <div className="growth-lifecycle-icon">{candidate.readiness === "READY_NOW" ? <CheckCircle2 size={16}/> : <AlertTriangle size={16}/>}</div>
          <div className="growth-lifecycle-copy">
            <strong>{candidate.person}</strong>
            <small>{candidate.employeeNumber} · {candidate.position}</small>
            <span>{candidate.developmentGap || c("No development gap recorded", "Gelişim açığı kaydedilmemiş")}</span>
            {candidate.readinessReviewedAt ? <span><ShieldCheck size={11}/> {c(`Readiness reviewed ${dateOnly(candidate.readinessReviewedAt)} by ${candidate.readinessReviewedBy ?? "governed reviewer"}`, `Hazırlık seviyesi ${dateOnly(candidate.readinessReviewedAt)} tarihinde ${candidate.readinessReviewedBy ?? "yönetişimli inceleyen"} tarafından değerlendirildi`)}{candidate.readinessReason ? ` · ${candidate.readinessReason}` : ""}</span> : <span>{c("No attested readiness decision recorded yet", "Henüz onaylı hazırlık kararı kaydedilmedi")}</span>}
            {candidate.latestTalent ? <span><Sparkles size={11}/> {candidate.latestTalent.cycleLabel} · {label(candidate.latestTalent.performance, locale)} / {label(candidate.latestTalent.potential, locale)}{candidate.latestTalent.criticalTalent ? ` · ${c("Critical talent", "Kritik yetenek")}` : ""}</span> : <span>{c("No governed talent assessment linked", "Bağlı yönetişimli yetenek değerlendirmesi yok")}</span>}
          </div>
          <div className="performance-review-controls"><select name="readiness" defaultValue={candidate.readiness}>{readinessValues.map((value) => <option key={value} value={value}>{label(value, locale)}</option>)}</select><textarea name="readinessReason" maxLength={2000} placeholder={c("Decision reason required when changing readiness (12+ characters)", "Hazırlık seviyesi değişiyorsa karar gerekçesi zorunlu (12+ karakter)")}/><input name="rank" type="number" min="1" max="99" placeholder={c("Rank", "Sıra")} defaultValue={candidate.rank ?? ""}/><input name="developmentGap" maxLength={2000} placeholder={c("Development gap", "Gelişim açığı")} defaultValue={candidate.developmentGap ?? ""}/><textarea name="removalReason" maxLength={2000} placeholder={c("Removal reason required to remove candidate (12+ characters)", "Adayı çıkarmak için gerekçe zorunlu (12+ karakter)")}/><button className="secondary-button" disabled={pending !== null}>{pending === `candidate-${candidate.id}` ? "…" : c("Save", "Kaydet")}</button><button className="secondary-button" type="button" disabled={pending !== null} onClick={(event) => {
            const form = event.currentTarget.form;
            const reason = form ? String(new FormData(form).get("removalReason") ?? "").trim() : "";
            if (reason.length < 12) {
              setNotice({ tone: "error", text: c("Enter a removal reason of at least 12 characters.", "En az 12 karakterlik çıkarma gerekçesi girin.") });
              return;
            }
            void mutate(`remove-${candidate.id}`, `/api/succession/candidates/${candidate.id}`, "DELETE", { removalReason: reason, expectedUpdatedAt: candidate.updatedAt });
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
