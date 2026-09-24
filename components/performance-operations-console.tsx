"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, CheckCircle2, CircleAlert, ClipboardCheck, Flag, ShieldCheck, Target, UsersRound } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { PerformanceOperationsData, PerformanceReviewOperation } from "@/lib/performance-operations-data";

type Props = PerformanceOperationsData;
type Notice = { tone: "ok" | "error"; text: string } | null;

const ratings = ["NEEDS_IMPROVEMENT", "DEVELOPING", "MEETS", "EXCEEDS", "OUTSTANDING"];
const cycleNext: Record<string, string | undefined> = { DRAFT: "OPEN", OPEN: "CALIBRATION", CALIBRATION: "FINALIZED", FINALIZED: "CLOSED" };
const goalNext: Record<string, string[]> = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["AT_RISK", "COMPLETED", "CANCELLED"],
  AT_RISK: ["ACTIVE", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: []
};

function label(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = {
    DRAFT: "Taslak", OPEN: "Açık", CALIBRATION: "Kalibrasyon", FINALIZED: "Kesinleşti", CLOSED: "Kapalı",
    NOT_STARTED: "Başlamadı", SELF_REVIEW: "Öz değerlendirme", MANAGER_REVIEW: "Yönetici değerlendirmesi",
    ACTIVE: "Aktif", AT_RISK: "Riskte", COMPLETED: "Tamamlandı", CANCELLED: "İptal",
    NEEDS_IMPROVEMENT: "Gelişim gerekli", DEVELOPING: "Gelişiyor", MEETS: "Beklentiyi karşılıyor", EXCEEDS: "Beklentiyi aşıyor", OUTSTANDING: "Üstün"
  };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function dateOnly(value: string) { return value.slice(0, 10); }

export function PerformanceOperationsConsole({ employments, cycles, reviews, goals }: Props) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  async function mutate(key: string, url: string, method: "POST" | "PATCH", payload: Record<string, unknown>) {
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
      setNotice({ tone: "ok", text: c("Performance record updated and audit evidence written.", "Performans kaydı güncellendi ve denetim kanıtı yazıldı.") });
      router.refresh();
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Transaction failed.", "İşlem başarısız.") });
      return false;
    } finally {
      setPending(null);
    }
  }

  async function createCycle(form: HTMLFormElement) {
    const data = new FormData(form);
    const ok = await mutate("new-cycle", "/api/performance/cycles", "POST", {
      name: data.get("name"), startsAt: data.get("startsAt"), endsAt: data.get("endsAt"), calibrationAt: data.get("calibrationAt") || null
    });
    if (ok) form.reset();
  }

  async function createGoal(form: HTMLFormElement) {
    const data = new FormData(form);
    const ok = await mutate("new-goal", "/api/performance/goals", "POST", {
      employmentId: data.get("employmentId"), title: data.get("title"), description: data.get("description"), weight: data.get("weight") || null,
      startsAt: data.get("startsAt"), dueAt: data.get("dueAt"), status: "DRAFT"
    });
    if (ok) form.reset();
  }

  async function createReview(form: HTMLFormElement) {
    const data = new FormData(form);
    const ok = await mutate("new-review", "/api/performance/reviews", "POST", {
      cycleId: data.get("cycleId"), employmentId: data.get("employmentId")
    });
    if (ok) form.reset();
  }

  const creatableCycles = cycles.filter((cycle) => ["DRAFT", "OPEN"].includes(cycle.status));

  return <section className="performance-console card">
    <div className="performance-console-head">
      <div><span className="section-kicker">{c("Human-owned performance transactions", "İnsan sahipliğinde performans işlemleri")}</span><h3>{c("Performance operations console", "Performans operasyon konsolu")}</h3><p>{c("Create cycles, goals and reviews; govern lifecycle state and final calibration. Employee self ratings and manager ratings are identity-bound and cannot be entered from this administration console.", "Döngü, hedef ve değerlendirme oluşturun; yaşam döngüsü durumunu ve nihai kalibrasyonu yönetin. Çalışan öz değerlendirme ve yönetici puanları kimliğe bağlıdır ve bu yönetim konsolundan girilemez.")}</p></div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Human decision boundary active", "İnsan karar sınırı aktif")}</span></div>
    </div>

    {notice ? <div className={`performance-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}

    <div className="performance-create-grid">
      <form className="performance-form" onSubmit={(event) => { event.preventDefault(); void createCycle(event.currentTarget); }}>
        <div className="performance-form-title"><Activity size={17}/><div><strong>{c("New review cycle", "Yeni değerlendirme döngüsü")}</strong><small>{c("Draft first, then explicitly open", "Önce taslak, sonra açıkça başlat")}</small></div></div>
        <label>{c("Cycle name", "Döngü adı")}<input name="name" required placeholder="2027 Annual Review"/></label>
        <div className="performance-form-row"><label>{c("Starts", "Başlangıç")}<input name="startsAt" type="date" required/></label><label>{c("Ends", "Bitiş")}<input name="endsAt" type="date" required/></label></div>
        <label>{c("Calibration date", "Kalibrasyon tarihi")}<input name="calibrationAt" type="date"/></label>
        <button className="create-button" disabled={pending !== null}>{pending === "new-cycle" ? c("Creating…", "Oluşturuluyor…") : c("Create draft cycle", "Taslak döngü oluştur")}</button>
      </form>

      <form className="performance-form" onSubmit={(event) => { event.preventDefault(); void createGoal(event.currentTarget); }}>
        <div className="performance-form-title"><Target size={17}/><div><strong>{c("New goal", "Yeni hedef")}</strong><small>{c("Relationship-scoped employee objective", "İlişki kapsamlı çalışan hedefi")}</small></div></div>
        <label>{c("Employee", "Çalışan")}<select name="employmentId" required defaultValue=""><option value="" disabled>{c("Select employee", "Çalışan seçin")}</option>{employments.map((employment) => <option key={employment.id} value={employment.id}>{employment.person} · {employment.position}</option>)}</select></label>
        <label>{c("Goal title", "Hedef başlığı")}<input name="title" required/></label>
        <label>{c("Description", "Açıklama")}<textarea name="description" rows={2}/></label>
        <div className="performance-form-row"><label>{c("Weight %", "Ağırlık %")}<input name="weight" type="number" min="0" max="100" step="0.01"/></label><label>{c("Starts", "Başlangıç")}<input name="startsAt" type="date" required/></label></div>
        <label>{c("Due", "Bitiş")}<input name="dueAt" type="date" required/></label>
        <button className="create-button" disabled={pending !== null || !employments.length}>{pending === "new-goal" ? c("Creating…", "Oluşturuluyor…") : c("Create draft goal", "Taslak hedef oluştur")}</button>
      </form>

      <form className="performance-form" onSubmit={(event) => { event.preventDefault(); void createReview(event.currentTarget); }}>
        <div className="performance-form-title"><ClipboardCheck size={17}/><div><strong>{c("New employee review", "Yeni çalışan değerlendirmesi")}</strong><small>{c("One review per employee and cycle", "Çalışan ve döngü başına tek değerlendirme")}</small></div></div>
        <label>{c("Cycle", "Döngü")}<select name="cycleId" required defaultValue=""><option value="" disabled>{c("Select cycle", "Döngü seçin")}</option>{creatableCycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name} · {label(cycle.status, locale)}</option>)}</select></label>
        <label>{c("Employee", "Çalışan")}<select name="employmentId" required defaultValue=""><option value="" disabled>{c("Select employee", "Çalışan seçin")}</option>{employments.map((employment) => <option key={employment.id} value={employment.id}>{employment.person} · {employment.employeeNumber}</option>)}</select></label>
        <div className="performance-console-health"><ShieldCheck size={14}/><span>{c("Manager is assigned automatically from the governed employment relationship.", "Yönetici, yönetişimli istihdam ilişkisinden otomatik atanır.")}</span></div>
        <button className="create-button" disabled={pending !== null || !employments.length || !creatableCycles.length}>{pending === "new-review" ? c("Creating…", "Oluşturuluyor…") : c("Create review", "Değerlendirme oluştur")}</button>
      </form>
    </div>

    <div className="performance-ops-grid">
      <div className="performance-ops-panel">
        <div className="performance-panel-title"><Flag size={16}/><div><strong>{c("Cycle governance", "Döngü yönetişimi")}</strong><small>{cycles.length} {c("cycles", "döngü")}</small></div></div>
        <div className="performance-operation-list">{cycles.length ? cycles.map((cycle) => {
          const next = cycleNext[cycle.status];
          return <div className="performance-operation" key={cycle.id}><div className="performance-operation-main"><strong>{cycle.name}</strong><small>{dateOnly(cycle.startsAt)} → {dateOnly(cycle.endsAt)} · {cycle.reviewCount} {c("reviews", "değerlendirme")}</small><em className={`growth-pill ${cycle.status.toLowerCase()}`}>{label(cycle.status, locale)}</em></div>{next ? <button className="secondary-button" type="button" disabled={pending !== null} onClick={() => void mutate(`cycle-${cycle.id}`, `/api/performance/cycles/${cycle.id}/transition`, "POST", { status: next })}>{pending === `cycle-${cycle.id}` ? "…" : label(next, locale)}</button> : null}</div>;
        }) : <p className="performance-empty">{c("No performance cycles.", "Performans döngüsü yok.")}</p>}</div>
      </div>

      <div className="performance-ops-panel">
        <div className="performance-panel-title"><UsersRound size={16}/><div><strong>{c("Review lifecycle", "Değerlendirme yaşam döngüsü")}</strong><small>{reviews.length} {c("governed reviews", "yönetişimli değerlendirme")}</small></div></div>
        <div className="performance-operation-list">{reviews.length ? reviews.map((review) => <ReviewOperation key={review.id} review={review} pending={pending} mutate={mutate}/>) : <p className="performance-empty">{c("No reviews have been created.", "Henüz değerlendirme oluşturulmadı.")}</p>}</div>
      </div>
    </div>

    <div className="performance-ops-panel goal-operations">
      <div className="performance-panel-title"><Target size={16}/><div><strong>{c("Goal execution", "Hedef yürütme")}</strong><small>{goals.length} {c("scoped goals", "kapsamlı hedef")}</small></div></div>
      <div className="performance-goal-grid">{goals.length ? goals.map((goal) => <form key={goal.id} className="performance-goal-card" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void mutate(`goal-${goal.id}`, `/api/performance/goals/${goal.id}`, "PATCH", { progress: Number(data.get("progress")), status: data.get("status") || undefined }); }}><div><strong>{goal.title}</strong><small>{goal.person} · {c("Due", "Bitiş")} {dateOnly(goal.dueAt)}</small></div><div className="performance-goal-controls"><input name="progress" type="number" min="0" max="100" defaultValue={goal.progress} disabled={["COMPLETED", "CANCELLED"].includes(goal.status)}/><span>%</span><select name="status" defaultValue="" disabled={["COMPLETED", "CANCELLED"].includes(goal.status)}><option value="">{label(goal.status, locale)}</option>{(goalNext[goal.status] ?? []).map((status) => <option key={status} value={status}>{label(status, locale)}</option>)}</select><button className="secondary-button" disabled={pending !== null || ["COMPLETED", "CANCELLED"].includes(goal.status)}>{pending === `goal-${goal.id}` ? "…" : c("Save", "Kaydet")}</button></div></form>) : <p className="performance-empty">{c("No goals in this scope.", "Bu kapsamda hedef yok.")}</p>}</div>
    </div>
  </section>;
}

function ReviewOperation({ review, pending, mutate }: { review: PerformanceReviewOperation; pending: string | null; mutate: (key: string, url: string, method: "POST" | "PATCH", payload: Record<string, unknown>) => Promise<boolean> }) {
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const next = review.status === "NOT_STARTED" ? "SELF_REVIEW" : review.status === "CALIBRATION" ? "FINALIZED" : undefined;
  const awaitingParticipant = review.status === "SELF_REVIEW" || review.status === "MANAGER_REVIEW";

  return <form className="performance-operation review-operation" onSubmit={(event) => {
    event.preventDefault();
    if (!next) return;
    const data = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = { status: next };
    if (review.status === "CALIBRATION") {
      payload.finalRating = data.get("finalRating");
      payload.calibrationNotes = data.get("calibrationNotes") || undefined;
    }
    void mutate(`review-${review.id}`, `/api/performance/reviews/${review.id}/transition`, "POST", payload);
  }}>
    <div className="performance-operation-main"><strong>{review.person}</strong><small>{review.cycleName}</small><div className="performance-rating-line"><em className={`growth-pill ${review.status.toLowerCase().replaceAll("_", "-")}`}>{label(review.status, locale)}</em>{review.finalRating ? <span>{c("Final", "Nihai")}: {label(review.finalRating, locale)}</span> : review.managerRating ? <span>{c("Manager", "Yönetici")}: {label(review.managerRating, locale)}</span> : review.selfRating ? <span>{c("Self", "Öz")}: {label(review.selfRating, locale)}</span> : null}</div></div>
    {review.status === "CALIBRATION" ? <div className="performance-review-controls"><select name="finalRating" required defaultValue={review.finalRating ?? ""}><option value="" disabled>{c("Select final calibration rating", "Nihai kalibrasyon puanı seçin")}</option>{ratings.map((ratingValue) => <option key={ratingValue} value={ratingValue}>{label(ratingValue, locale)}</option>)}</select><input name="calibrationNotes" placeholder={c("Calibration note", "Kalibrasyon notu")}/><button className="secondary-button" disabled={pending !== null}>{pending === `review-${review.id}` ? "…" : label("FINALIZED", locale)}</button></div> : next ? <div className="performance-review-controls"><button className="secondary-button" disabled={pending !== null}>{pending === `review-${review.id}` ? "…" : label(next, locale)}</button></div> : awaitingParticipant ? <div className="performance-finalized"><UsersRound size={14}/>{review.status === "SELF_REVIEW" ? c("Waiting for employee submission", "Çalışan gönderimi bekleniyor") : c("Waiting for assigned manager", "Atanmış yönetici bekleniyor")}</div> : <div className="performance-finalized"><CheckCircle2 size={14}/>{c("Finalized", "Kesinleşti")}</div>}
  </form>;
}