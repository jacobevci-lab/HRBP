"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenCheck, CheckCircle2, CircleAlert, Clock3, ShieldCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { LearningParticipantAssignment } from "@/lib/learning-participant-data";

function label(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = { ASSIGNED: "Atandı", IN_PROGRESS: "Devam ediyor", OVERDUE: "Gecikmiş", COMPLETED: "Tamamlandı" };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function dateOnly(value: string | null) { return value ? value.slice(0, 10) : "—"; }

export function LearningParticipantConsole({ assignments }: { assignments: LearningParticipantAssignment[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

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
      <div><span className="section-kicker">{c("My learning", "Eğitimlerim")}</span><h3>{c("Assigned learning actions", "Atanmış eğitim aksiyonları")}</h3><p>{c("Start your assigned learning and submit completion evidence for your own employment record. Waivers and compliance overrides remain administrator-owned.", "Atanmış eğitimlerinizi başlatın ve yalnız kendi istihdam kaydınız için tamamlama kanıtı gönderin. Muafiyet ve uyum istisnaları yönetici sahipliğinde kalır.")}</p></div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Identity-bound progress", "Kimliğe bağlı ilerleme")}</span></div>
    </div>

    {notice ? <div className={`performance-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}

    <div className="growth-lifecycle-list">{assignments.map((assignment) => <form className="growth-lifecycle-row" key={assignment.id} onSubmit={(event) => {
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
      <div className="growth-lifecycle-copy"><strong>{assignment.course}</strong><small>{assignment.courseCode} · {assignment.provider}</small><span>{assignment.mandatory ? c("Mandatory", "Zorunlu") : c("Development", "Gelişim")} · <Clock3 size={11}/> {c("Due", "Son tarih")} {dateOnly(assignment.dueAt)}</span></div>
      <em className={`growth-pill ${assignment.status.toLowerCase().replaceAll("_", "-")}`}>{label(assignment.status, locale)}</em>
      <div className="performance-review-controls">{assignment.status !== "ASSIGNED" ? <><input name="score" type="number" min="0" max="100" step="0.01" placeholder={c("Score", "Puan")}/><input name="certificateReference" maxLength={500} placeholder={c("Certificate / evidence reference", "Sertifika / kanıt referansı")}/></> : null}<button className="secondary-button" disabled={pending !== null}>{pending === `learning-self-${assignment.id}` ? "…" : assignment.status === "ASSIGNED" ? c("Start", "Başlat") : c("Complete", "Tamamla")}</button></div>
    </form>)}</div>
  </section>;
}
