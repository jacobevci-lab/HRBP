"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, ClipboardCheck, ShieldCheck, Target, UsersRound } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { PerformanceParticipantData } from "@/lib/performance-participant-data";

type Notice = { tone: "ok" | "error"; text: string } | null;

const ratings = ["NEEDS_IMPROVEMENT", "DEVELOPING", "MEETS", "EXCEEDS", "OUTSTANDING"];

function label(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = {
    NOT_STARTED: "Başlamadı",
    SELF_REVIEW: "Öz değerlendirme",
    MANAGER_REVIEW: "Yönetici değerlendirmesi",
    CALIBRATION: "Kalibrasyon",
    ACTIVE: "Aktif",
    AT_RISK: "Riskte",
    NEEDS_IMPROVEMENT: "Gelişim gerekli",
    DEVELOPING: "Gelişiyor",
    MEETS: "Beklentiyi karşılıyor",
    EXCEEDS: "Beklentiyi aşıyor",
    OUTSTANDING: "Üstün"
  };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function dueDate(value: string, locale: "en" | "tr") {
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { dateStyle: "medium" }).format(new Date(value));
}

export function PerformanceParticipantConsole({ selfReviews, managerReviews, ownGoals }: PerformanceParticipantData) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  if (!selfReviews.length && !managerReviews.length && !ownGoals.length) return null;

  async function submit(key: string, url: string, payload: Record<string, unknown>, method: "POST" | "PATCH" = "POST") {
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
      setNotice({ tone: "ok", text: c("Performance action saved and audit evidence written.", "Performans aksiyonu kaydedildi ve denetim kanıtı yazıldı.") });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Submission failed.", "Gönderim başarısız.") });
    } finally {
      setPending(null);
    }
  }

  return <section className="performance-console card">
    <div className="performance-console-head">
      <div>
        <span className="section-kicker">{c("My performance actions", "Performans aksiyonlarım")}</span>
        <h3>{c("Participant performance inbox", "Katılımcı performans kutusu")}</h3>
        <p>{c("Self ratings, assigned-manager ratings and personal goal progress are identity-bound. HR governance controls lifecycle and calibration without impersonating participant decisions.", "Öz değerlendirme, atanmış yönetici puanı ve kişisel hedef ilerlemesi kimliğe bağlıdır. İK yönetişimi katılımcı kararlarının yerine geçmeden yaşam döngüsünü ve kalibrasyonu yönetir.")}</p>
      </div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Identity-bound decisions", "Kimliğe bağlı kararlar")}</span></div>
    </div>

    {notice ? <div className={`performance-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}

    <div className="performance-ops-grid">
      <div className="performance-ops-panel">
        <div className="performance-panel-title"><ClipboardCheck size={16}/><div><strong>{c("My self reviews", "Öz değerlendirmelerim")}</strong><small>{selfReviews.length} {c("awaiting submission", "gönderim bekliyor")}</small></div></div>
        <div className="performance-operation-list">{selfReviews.length ? selfReviews.map((review) => <form key={review.id} className="performance-operation review-operation" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void submit(`self-${review.id}`, `/api/performance/reviews/${review.id}/self-submit`, { selfRating: data.get("selfRating") });
        }}>
          <div className="performance-operation-main"><strong>{review.cycle}</strong><small>{c("Your rating moves this review to the assigned manager.", "Puanınız bu değerlendirmeyi atanmış yöneticiye taşır.")}</small><div className="performance-rating-line"><em className={`growth-pill ${review.status.toLowerCase().replaceAll("_", "-")}`}>{label(review.status, locale)}</em></div></div>
          <div className="performance-review-controls"><select name="selfRating" required defaultValue={review.selfRating ?? ""}><option value="" disabled>{c("Select self rating", "Öz değerlendirme puanı seçin")}</option>{ratings.map((ratingValue) => <option key={ratingValue} value={ratingValue}>{label(ratingValue, locale)}</option>)}</select><button className="secondary-button" disabled={pending !== null}>{pending === `self-${review.id}` ? "…" : c("Submit to manager", "Yöneticiye gönder")}</button></div>
        </form>) : <p className="performance-empty">{c("No self review requires action.", "Aksiyon bekleyen öz değerlendirme yok.")}</p>}</div>
      </div>

      <div className="performance-ops-panel">
        <div className="performance-panel-title"><UsersRound size={16}/><div><strong>{c("Manager reviews", "Yönetici değerlendirmeleri")}</strong><small>{managerReviews.length} {c("assigned reviews", "atanmış değerlendirme")}</small></div></div>
        <div className="performance-operation-list">{managerReviews.length ? managerReviews.map((review) => <form key={review.id} className="performance-operation review-operation" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void submit(`manager-${review.id}`, `/api/performance/reviews/${review.id}/manager-submit`, { managerRating: data.get("managerRating") });
        }}>
          <div className="performance-operation-main"><strong>{review.person}</strong><small>{review.cycle} · {review.position} · {review.employeeNumber}</small><div className="performance-rating-line"><em className="growth-pill manager-review">{c("Manager review", "Yönetici değerlendirmesi")}</em>{review.selfRating ? <span>{c("Self", "Öz")}: {label(review.selfRating, locale)}</span> : null}</div></div>
          <div className="performance-review-controls"><select name="managerRating" required defaultValue=""><option value="" disabled>{c("Select manager rating", "Yönetici puanı seçin")}</option>{ratings.map((ratingValue) => <option key={ratingValue} value={ratingValue}>{label(ratingValue, locale)}</option>)}</select><button className="secondary-button" disabled={pending !== null}>{pending === `manager-${review.id}` ? "…" : c("Submit to calibration", "Kalibrasyona gönder")}</button></div>
        </form>) : <p className="performance-empty">{c("No manager review requires action.", "Aksiyon bekleyen yönetici değerlendirmesi yok.")}</p>}</div>
      </div>
    </div>

    {ownGoals.length ? <div className="performance-ops-panel goal-operations">
      <div className="performance-panel-title"><Target size={16}/><div><strong>{c("My goal progress", "Hedef ilerlemem")}</strong><small>{ownGoals.length} {c("active goals", "aktif hedef")}</small></div></div>
      <div className="performance-goal-grid">{ownGoals.map((goal) => <form key={goal.id} className="performance-goal-card" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void submit(`own-goal-${goal.id}`, `/api/performance/goals/${goal.id}/self-progress`, { progress: Number(data.get("progress")) }, "PATCH");
      }}>
        <div><strong>{goal.title}</strong><small>{label(goal.status, locale)} · {c("Due", "Bitiş")} {dueDate(goal.dueAt, locale)}</small></div>
        <div className="performance-goal-controls"><input name="progress" type="number" min="0" max="100" required defaultValue={goal.progress}/><span>%</span><button className="secondary-button" disabled={pending !== null}>{pending === `own-goal-${goal.id}` ? "…" : c("Update progress", "İlerlemeyi güncelle")}</button></div>
      </form>)}</div>
    </div> : null}
  </section>;
}
