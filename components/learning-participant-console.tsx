"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenCheck, CheckCircle2, CircleAlert, Clock3, ShieldCheck, Sparkles } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { LearningParticipantAssignment } from "@/lib/learning-participant-data";

function label(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = {
    ASSIGNED: "Atandı", IN_PROGRESS: "Devam ediyor", OVERDUE: "Gecikmiş", COMPLETED: "Tamamlandı", WAIVED: "Muaf",
    AWARENESS: "Farkındalık", FOUNDATION: "Temel", PRACTITIONER: "Uygulayıcı", ADVANCED: "İleri", EXPERT: "Uzman"
  };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function dateOnly(value: string | null) { return value ? value.slice(0, 10) : "—"; }

async function acknowledgeLearningNotification(assignmentId: string) {
  try {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceType: "LearningAssignment", resourceId: assignmentId, read: true })
    });
    if (response.ok) window.dispatchEvent(new Event("hrbp:notifications-changed"));
  } catch {
    // Notification cleanup is best-effort and cannot roll back learning progress.
  }
}

export function LearningParticipantConsole({ assignments }: { assignments: LearningParticipantAssignment[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    document.querySelector<HTMLElement>(".growth-lifecycle-row.focused")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const actionable = assignments.filter((assignment) => ["ASSIGNED", "IN_PROGRESS", "OVERDUE"].includes(assignment.status));
  const history = assignments.filter((assignment) => ["COMPLETED", "WAIVED"].includes(assignment.status));

  if (!assignments.length) return null;

  async function transition(key: string, id: string, payload: Record<string, unknown>) {
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(`/api/learning/assignments/${id}/self-transition`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`, `İstek başarısız (${response.status})`));
      await acknowledgeLearningNotification(id);
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      setNotice({ tone: "ok", text: c("Learning progress saved and audit evidence written.", "Eğitim ilerlemesi kaydedildi ve denetim kanıtı yazıldı.") });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Transaction failed.", "İşlem başarısız.") });
    } finally {
      setPending(null);
    }
  }

  return <section className="performance-console card growth-lifecycle-console">
    <div className="performance-console-head">
      <div><span className="section-kicker">{c("My learning", "Eğitimlerim")}</span><h3>{c("Assigned learning actions", "Atanmış eğitim aksiyonları")}</h3><p>{c("Start assigned learning and submit completion evidence for your own employment record. Development-plan and succession learning remain evidence for later human reassessment; completing a course never auto-promotes proficiency, talent or succession status.", "Atanmış eğitimleri başlatın ve yalnız kendi istihdam kaydınız için tamamlama kanıtı gönderin. Gelişim planı ve yedekleme eğitimleri daha sonraki insan değerlendirmesi için kanıt olarak kalır; eğitimi tamamlamak yetkinlik, yetenek veya yedekleme durumunu otomatik yükseltmez.")}</p></div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Identity-bound progress", "Kimliğe bağlı ilerleme")}</span></div>
    </div>

    {notice ? <div className={`performance-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}

    <div className="growth-lifecycle-list">{actionable.length ? actionable.map((assignment) => <form id={`learning-assignment-${assignment.id}`} className={`growth-lifecycle-row${assignment.focused ? " focused" : ""}`} key={assignment.id} onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const next = assignment.status === "ASSIGNED" ? "IN_PROGRESS" : "COMPLETED";
      void transition(`learning-self-${assignment.id}`, assignment.id, {
        status: next,
        score: next === "COMPLETED" ? data.get("score") || undefined : undefined,
        certificateReference: next === "COMPLETED" ? data.get("certificateReference") || undefined : undefined
      });
    }}>
      <div className="growth-lifecycle-icon"><BookOpenCheck size={16}/></div>
      <div className="growth-lifecycle-copy"><strong>{assignment.course}</strong><small>{assignment.courseCode} · {assignment.provider}</small><span>{assignment.mandatory ? c("Mandatory", "Zorunlu") : c("Development", "Gelişim")} · <Clock3 size={11}/> {c("Due", "Son tarih")} {dateOnly(assignment.dueAt)}</span>{assignment.developmentPlanTitle && assignment.developmentSkillName ? <span><Sparkles size={11}/> {c("Development plan", "Gelişim planı")}: {assignment.developmentPlanTitle} · {assignment.developmentSkillCode} · {assignment.developmentSkillName}{assignment.targetProficiency ? ` → ${label(assignment.targetProficiency, locale)}` : ""}{assignment.successionCandidateId ? ` · ${c("succession-linked", "yedeklemeye bağlı")}` : ""}</span> : assignment.successionCandidateId && assignment.developmentSkillName ? <span><Sparkles size={11}/> {c("Succession development", "Yedekleme gelişimi")} · {assignment.developmentSkillCode} · {assignment.developmentSkillName}{assignment.targetProficiency ? ` → ${label(assignment.targetProficiency, locale)}` : ""}</span> : null}</div>
      <em className={`growth-pill ${assignment.status.toLowerCase().replaceAll("_", "-")}`}>{label(assignment.status, locale)}</em>
      <div className="performance-review-controls">{assignment.status !== "ASSIGNED" ? <><input name="score" type="number" min="0" max="100" step="0.01" placeholder={c("Score", "Puan")}/><input name="certificateReference" maxLength={500} placeholder={c("Certificate / evidence reference", "Sertifika / kanıt referansı")}/></> : null}<button className="secondary-button" disabled={pending !== null}>{pending === `learning-self-${assignment.id}` ? "…" : assignment.status === "ASSIGNED" ? c("Start", "Başlat") : c("Complete", "Tamamla")}</button></div>
    </form>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No active learning assignments.", "Aktif eğitim atamanız yok.")}</span></div>}</div>

    <div className="performance-ops-panel">
      <div className="performance-panel-title"><BookOpenCheck size={16}/><div><strong>{c("Learning history", "Eğitim geçmişim")}</strong><small>{c("Up to 100 recently assigned completed or waived records; no changes can be made here.", "Son atanmış en fazla 100 tamamlanmış veya muaf kayıt; burada değişiklik yapılamaz.")}</small></div></div>
      <div className="growth-lifecycle-list">{history.length ? history.map((assignment) => <article id={`learning-assignment-${assignment.id}`} className={`growth-lifecycle-row${assignment.focused ? " focused" : ""}`} key={assignment.id}>
        <div className="growth-lifecycle-icon"><BookOpenCheck size={16}/></div>
        <div className="growth-lifecycle-copy">
          <strong>{assignment.course}</strong>
          <small>{assignment.courseCode} · {assignment.provider}</small>
          <span>{assignment.mandatory ? c("Mandatory", "Zorunlu") : c("Development", "Gelişim")} · {c("Assigned", "Atandı")}: {dateOnly(assignment.assignedAt)} · {c("Due", "Son tarih")}: {dateOnly(assignment.dueAt)}</span>
          {assignment.status === "COMPLETED" ? <span><CheckCircle2 size={12}/> {c("Completed", "Tamamlandı")}: {dateOnly(assignment.completedAt)}{assignment.score !== null ? ` · ${c("Score", "Puan")}: ${assignment.score}/100` : ""}</span> : <span><ShieldCheck size={12}/> {c("Waived", "Muaf")}: {dateOnly(assignment.waivedAt)}</span>}
          {assignment.certificateReference ? <span>{c("Certificate / evidence reference", "Sertifika / kanıt referansı")}: {assignment.certificateReference}</span> : null}
          {assignment.developmentPlanTitle ? <span><Sparkles size={12}/> {c("Development plan", "Gelişim planı")}: {assignment.developmentPlanTitle}</span> : null}
          {assignment.successionCandidateId ? <span><Sparkles size={12}/> {c("Succession-linked", "Yedekleme bağlantılı")}</span> : null}
        </div>
        <em className={`growth-pill ${assignment.status.toLowerCase()}`}>{label(assignment.status, locale)}</em>
      </article>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No completed or waived learning history yet.", "Henüz tamamlanmış veya muaf eğitim geçmişiniz yok.")}</span></div>}</div>
    </div>
  </section>;
}
