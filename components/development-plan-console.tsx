"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenCheck, CheckCircle2, CircleAlert, Route, ShieldCheck, Target, UserRoundCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { DevelopmentPlanGovernanceData } from "@/lib/development-plan-data";
import type { TalentGovernanceRow } from "@/lib/talent-governance-data";

const proficiencyValues = ["AWARENESS", "FOUNDATION", "PRACTITIONER", "ADVANCED", "EXPERT"];

function label(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = {
    DRAFT: "Taslak",
    ACTIVE: "Aktif",
    COMPLETED: "Tamamlandı",
    CANCELLED: "İptal",
    ASSIGNED: "Atandı",
    IN_PROGRESS: "Devam ediyor",
    OVERDUE: "Gecikmiş",
    WAIVED: "Muaf",
    AWARENESS: "Farkındalık",
    FOUNDATION: "Temel",
    PRACTITIONER: "Uygulayıcı",
    ADVANCED: "İleri",
    EXPERT: "Uzman"
  };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function dateOnly(value: string | null) { return value ? value.slice(0, 10) : "—"; }

export function DevelopmentPlanConsole({
  plans,
  skills,
  courses,
  assessments,
  allowLearningPlan
}: DevelopmentPlanGovernanceData & { assessments: TalentGovernanceRow[]; allowLearningPlan: boolean }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const assessmentMap = useMemo(() => new Map(assessments.map((assessment) => [assessment.id, assessment])), [assessments]);

  async function request(key: string, url: string, method: "POST" | "PATCH", payload: Record<string, unknown>, success: string) {
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`, `İstek başarısız (${response.status})`));
      setNotice({ tone: "ok", text: success });
      router.refresh();
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Transaction failed.", "İşlem başarısız.") });
      return false;
    } finally {
      setPending(null);
    }
  }

  async function createPlan(form: HTMLFormElement) {
    const data = new FormData(form);
    const assessment = assessmentMap.get(String(data.get("sourceAssessmentId") ?? ""));
    if (!assessment) {
      setNotice({ tone: "error", text: c("Select a governed talent assessment.", "Yönetişimli bir yetenek değerlendirmesi seçin.") });
      return;
    }
    const ok = await request("new-development-plan", "/api/talent/development-plans", "POST", {
      employmentId: assessment.employmentId,
      sourceAssessmentId: assessment.id,
      title: data.get("title"),
      objective: data.get("objective") || null,
      focusSkillId: data.get("focusSkillId") || null,
      targetProficiency: data.get("targetProficiency") || null,
      startsAt: data.get("startsAt"),
      targetAt: data.get("targetAt")
    }, c("Development plan created and audit evidence written.", "Gelişim planı oluşturuldu ve denetim kanıtı yazıldı."));
    if (ok) form.reset();
  }

  return <section className="performance-console card growth-lifecycle-console">
    <div className="performance-console-head">
      <div>
        <span className="section-kicker">{c("Connected development", "Bağlı gelişim")}</span>
        <h3>{c("Individual development plans", "Bireysel gelişim planları")}</h3>
        <p>{c("Turn explicit talent assessments into governed development objectives, linked learning evidence and human-confirmed skill outcomes. Learning completion never auto-promotes proficiency or talent status.", "Açık yetenek değerlendirmelerini yönetişimli gelişim hedeflerine, bağlı eğitim kanıtlarına ve insan tarafından doğrulanan yetkinlik sonuçlarına dönüştürün. Eğitim tamamlama yetkinlik veya yetenek durumunu otomatik yükseltmez.")}</p>
      </div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Human outcome confirmation", "İnsan sonuç doğrulaması")}</span></div>
    </div>

    {notice ? <div className={`performance-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}

    <form className="performance-form" onSubmit={(event) => { event.preventDefault(); void createPlan(event.currentTarget); }}>
      <div className="performance-form-title"><Route size={17}/><div><strong>{c("Create from talent assessment", "Yetenek değerlendirmesinden oluştur")}</strong><small>{c("Assessment → skill target → learning evidence → reassessment", "Değerlendirme → yetkinlik hedefi → eğitim kanıtı → yeniden değerlendirme")}</small></div></div>
      <label>{c("Talent assessment", "Yetenek değerlendirmesi")}<select name="sourceAssessmentId" required defaultValue=""><option value="" disabled>{c("Select assessment", "Değerlendirme seçin")}</option>{assessments.map((assessment) => <option key={assessment.id} value={assessment.id}>{assessment.person} · {assessment.cycleLabel} · {label(assessment.performance, locale)} / {label(assessment.potential, locale)}</option>)}</select></label>
      <div className="performance-form-row"><label>{c("Focus skill", "Odak yetkinlik")}<select name="focusSkillId" required defaultValue=""><option value="" disabled>{c("Select active skill", "Aktif yetkinlik seçin")}</option>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.code} · {skill.name}</option>)}</select></label><label>{c("Target proficiency", "Hedef seviye")}<select name="targetProficiency" required defaultValue=""><option value="" disabled>{c("Select target", "Hedef seçin")}</option>{proficiencyValues.map((value) => <option key={value} value={value}>{label(value, locale)}</option>)}</select></label></div>
      <label>{c("Plan title", "Plan başlığı")}<input name="title" required maxLength={240} placeholder={c("Leadership readiness development", "Liderlik hazırlığı gelişimi")}/></label>
      <label>{c("Objective", "Hedef açıklaması")}<textarea name="objective" rows={2} maxLength={4000}/></label>
      <div className="performance-form-row"><label>{c("Starts", "Başlangıç")}<input name="startsAt" type="date" required/></label><label>{c("Target date", "Hedef tarih")}<input name="targetAt" type="date" required/></label></div>
      <button className="create-button" disabled={pending !== null || !assessments.length || !skills.length}>{pending === "new-development-plan" ? c("Creating…", "Oluşturuluyor…") : c("Create draft plan", "Taslak plan oluştur")}</button>
    </form>

    <div className="growth-lifecycle-list">{plans.length ? plans.map((plan) => {
      const terminal = plan.status === "COMPLETED" || plan.status === "CANCELLED";
      const canAddLearning = allowLearningPlan && !terminal && Boolean(plan.focusSkillId && plan.targetProficiency);
      return <article className="performance-ops-panel" key={plan.id}>
        <div className="performance-panel-title">
          <UserRoundCheck size={16}/><div><strong>{plan.person} · {plan.title}</strong><small>{plan.employeeNumber} · {plan.position} · {c("Owner", "Sahip")}: {plan.owner}{plan.sourceCycleLabel ? ` · ${plan.sourceCycleLabel}` : ""}</small></div>
          <em className={`growth-pill ${plan.status.toLowerCase()}`}>{label(plan.status, locale)}</em>
        </div>

        <div className="growth-lifecycle-copy" style={{ marginBottom: 10 }}>
          <span>{plan.focusSkill ? `${plan.focusSkillCode} · ${plan.focusSkill}` : c("No focus skill", "Odak yetkinlik yok")} {plan.targetProficiency ? `· ${c("Current", "Mevcut")}: ${plan.currentProficiency ? label(plan.currentProficiency, locale) : "—"} → ${c("Target", "Hedef")}: ${label(plan.targetProficiency, locale)}` : ""}</span>
          <span>{dateOnly(plan.startsAt)} → {dateOnly(plan.targetAt)} · {plan.assignments.length} {c("learning actions", "eğitim aksiyonu")}{plan.successionCandidateId ? ` · ${c("Linked to succession", "Yedeklemeye bağlı")}` : ""}</span>
        </div>

        {!terminal ? <form className="performance-operation review-operation" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void request(`edit-${plan.id}`, `/api/talent/development-plans/${plan.id}`, "PATCH", {
            title: data.get("title"), objective: data.get("objective") || null, targetAt: data.get("targetAt")
          }, c("Development plan updated and audit evidence written.", "Gelişim planı güncellendi ve denetim kanıtı yazıldı."));
        }}>
          <div className="performance-review-controls"><input name="title" maxLength={240} required defaultValue={plan.title}/><input name="objective" maxLength={4000} defaultValue={plan.objective ?? ""} placeholder={c("Objective", "Hedef açıklaması")}/><input name="targetAt" type="date" required defaultValue={dateOnly(plan.targetAt)}/><button className="secondary-button" disabled={pending !== null}>{pending === `edit-${plan.id}` ? "…" : c("Save plan", "Planı kaydet")}</button></div>
        </form> : null}

        <div className="growth-lifecycle-list">{plan.assignments.length ? plan.assignments.map((assignment) => <div className="growth-lifecycle-row" key={assignment.id}><div className="growth-lifecycle-icon"><BookOpenCheck size={16}/></div><div className="growth-lifecycle-copy"><strong>{assignment.courseTitle}</strong><small>{assignment.courseCode}</small><span>{c("Due", "Son tarih")}: {dateOnly(assignment.dueAt)}</span></div><em className={`growth-pill ${assignment.status.toLowerCase().replaceAll("_", "-")}`}>{label(assignment.status, locale)}</em></div>) : <div className="growth-lifecycle-empty"><Target size={18}/><span>{c("No learning action is linked yet.", "Henüz bağlı eğitim aksiyonu yok.")}</span></div>}</div>

        {canAddLearning ? <form className="performance-operation review-operation" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void request(`learning-${plan.id}`, `/api/talent/development-plans/${plan.id}/learning-assignment`, "POST", {
            courseId: data.get("courseId"), dueAt: data.get("dueAt")
          }, c("Learning action linked to the development plan.", "Eğitim aksiyonu gelişim planına bağlandı."));
        }}>
          <div className="performance-operation-main"><strong>{c("Add governed learning action", "Yönetişimli eğitim aksiyonu ekle")}</strong><small>{c("The employee receives the assignment through the existing learning inbox.", "Çalışan atamayı mevcut eğitim kutusu üzerinden alır.")}</small></div>
          <div className="performance-review-controls"><select name="courseId" required defaultValue=""><option value="" disabled>{c("Select course", "Eğitim seçin")}</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} · {course.title} · {course.provider}</option>)}</select><input name="dueAt" type="date" required max={dateOnly(plan.targetAt)}/><button className="secondary-button" disabled={pending !== null || !courses.length}>{pending === `learning-${plan.id}` ? "…" : c("Assign", "Ata")}</button></div>
        </form> : null}

        {!terminal ? <div className="performance-review-controls" style={{ marginTop: 10 }}>
          {plan.status === "DRAFT" ? <button className="secondary-button" type="button" disabled={pending !== null} onClick={() => void request(`activate-${plan.id}`, `/api/talent/development-plans/${plan.id}`, "PATCH", { status: "ACTIVE" }, c("Development plan activated.", "Gelişim planı aktifleştirildi."))}>{pending === `activate-${plan.id}` ? "…" : c("Activate", "Aktifleştir")}</button> : null}
          {plan.status === "ACTIVE" ? <form className="performance-review-controls" onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void request(`complete-${plan.id}`, `/api/talent/development-plans/${plan.id}`, "PATCH", { status: "COMPLETED", outcomeNotes: data.get("outcomeNotes") }, c("Development plan completed with human-confirmed outcome evidence.", "Gelişim planı insan doğrulamalı sonuç kanıtıyla tamamlandı."));
          }}><input name="outcomeNotes" required maxLength={4000} placeholder={c("Human outcome / reassessment notes", "İnsan sonucu / yeniden değerlendirme notu")}/><button className="secondary-button" disabled={pending !== null}>{pending === `complete-${plan.id}` ? "…" : c("Complete plan", "Planı tamamla")}</button></form> : null}
          <button className="secondary-button" type="button" disabled={pending !== null} onClick={() => void request(`cancel-${plan.id}`, `/api/talent/development-plans/${plan.id}`, "PATCH", { status: "CANCELLED" }, c("Development plan cancelled with history preserved.", "Gelişim planı geçmiş korunarak iptal edildi."))}>{pending === `cancel-${plan.id}` ? "…" : c("Cancel", "İptal")}</button>
        </div> : plan.outcomeNotes ? <div className="growth-lifecycle-copy"><span>{c("Outcome", "Sonuç")}: {plan.outcomeNotes}</span></div> : null}
      </article>;
    }) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No individual development plans are available in your authorized scope.", "Yetkili kapsamınızda bireysel gelişim planı yok.")}</span></div>}</div>
  </section>;
}
