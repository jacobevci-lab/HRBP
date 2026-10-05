"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, CircleAlert, Clock3, Send, ShieldCheck, TimerReset } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { parseTimeDraft, submitTimeAction, timeDraftFromForm, type TimeClientAction, type TimeClientResult } from "@/lib/time-client-action";
import type { TimeParticipantData } from "@/lib/time-participant-data";

function dateOnly(value: string) { return value.slice(0, 10); }
function timeOnly(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function hours(minutes: number) { return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
function statusLabel(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = { DRAFT: "Taslak", SUBMITTED: "Onay bekliyor", APPROVED: "Onaylandı", REJECTED: "Reddedildi", LOCKED: "Bordroya kilitli" };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}
type Props = { employmentId: string; data: TimeParticipantData };
// A different employment must not inherit pending responses or another employee's draft.
export function TimeParticipantConsole(props: Props) {
  return <TimeParticipantControl key={props.employmentId} {...props}/>;
}
function TimeParticipantControl({ employmentId, data }: Props) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [result, setResult] = useState<TimeClientResult | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [reloading, setReloading] = useState(false);
  const locked = useRef(false), mounted = useRef(true), reloadLock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const blocked = pending !== null || needsReview;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  function invalidInput() {
    setNotice({ tone: "error", text: c("Check the work date, whole worked/overtime minutes and the complete start/end interval. Nothing was sent.", "Çalışma tarihini, tam sayı dakika değerlerini ve başlangıç/bitiş aralığını kontrol edin. İstek gönderilmedi.") });
  }
  async function mutate(key: string, action: TimeClientAction, reset?: () => void) {
    if (locked.current || needsReview || !mounted.current) return;
    locked.current = true;
    if (action.kind === "submit" && !window.confirm(c("Submit this time entry for manager approval?", "Bu zaman kaydı yönetici onayına gönderilsin mi?"))) {
      locked.current = false; return;
    }
    setPending(key); setNotice(null); setResult(null);
    const active = new AbortController(); controller.current = active;
    let outcome: TimeClientResult;
    try { outcome = await submitTimeAction(action, { signal: active.signal }); }
    catch { outcome = { outcome: "unknown" }; }
    if (!mounted.current || active.signal.aborted) return;
    setPending(null); setResult(outcome);
    const mayCorrect = outcome.outcome === "invalid" || (action.kind === "create" && outcome.outcome === "rejected" && [400, 413, 422, 429].includes(outcome.status));
    if (mayCorrect) {
      locked.current = false;
      if (outcome.outcome === "invalid") invalidInput();
      else setNotice({ tone: "error", text: outcome.status === 429
        ? c("Too many requests. Your input is preserved; review it and try again later.", "Çok fazla istek gönderildi. Bilgileriniz korundu; kontrol edip daha sonra tekrar deneyin.")
        : c("The draft was not accepted. Your input is preserved; check the fields before trying again.", "Taslak kabul edilmedi. Bilgileriniz korundu; tekrar denemeden önce alanları kontrol edin.") });
      return;
    }
    // A saved or uncertain result cannot unlock an old row or replay a create on router.refresh.
    setNeedsReview(true);
    if (outcome.outcome === "saved") {
      setNotice({ tone: "ok", text: outcome.status === "DRAFT"
        ? c("Draft confirmed by the server. Reload and review it before submitting for approval.", "Taslak sunucu yanıtıyla doğrulandı. Onaya göndermeden önce listeyi yenileyip kaydı kontrol edin.")
        : c("Submission confirmed by the server. This entry is awaiting approval, not approved or payroll-locked.", "Gönderim sunucu yanıtıyla doğrulandı. Kayıt onay bekliyor; henüz onaylanmış veya bordroya kilitlenmiş değil.") });
      if (action.kind === "create") { try { reset?.(); } catch { /* A form reset failure does not undo a confirmed write. */ } }
      try { window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed")); router.refresh(); } catch { /* Keep the confirmed result even if refresh fails. */ }
      return;
    }
    setNotice({ tone: "error", text: outcome.outcome === "unknown"
      ? c("The result could not be confirmed; it may have been saved. Your input is preserved. No automatic retry was made. Reload and check current records before another action.", "Sonuç doğrulanamadı; işlem kaydedilmiş olabilir. Bilgileriniz korundu. Otomatik tekrar gönderilmedi. Yeni işlemden önce sayfayı yenileyip kayıtları kontrol edin.")
      : outcome.outcome === "rejected" && outcome.status === 401
        ? c("Your session could not be verified. Reload and sign in again.", "Oturum doğrulanamadı. Sayfayı yenileyip yeniden giriş yapın.")
        : outcome.outcome === "rejected" && outcome.status === 403
          ? c("This action is not authorized. Reload to review your current access.", "Bu işlem için yetkiniz doğrulanamadı. Güncel erişiminizi kontrol etmek için yenileyin.")
          : c("The entry, schedule or current state did not allow this action. Reload and review current records; nothing was automatically retried.", "Kayıt, çalışma planı veya güncel durum bu işleme izin vermedi. Sayfayı yenileyip kayıtları kontrol edin; otomatik tekrar yapılmadı.") });
  }
  function submitEntry(row: TimeParticipantData["entries"][number]) {
    if (locked.current || needsReview || !data.schedule || (row.status !== "DRAFT" && row.status !== "REJECTED")) return;
    const draft = parseTimeDraft({ ...row, employmentId, workDate: dateOnly(row.workDate) });
    if (!draft) { invalidInput(); return; }
    void mutate(`submit-${row.id}`, { kind: "submit", entryId: row.id, priorStatus: row.status, draft });
  }

  return <section className="performance-console card growth-lifecycle-console" data-time-console={employmentId} aria-busy={pending !== null}>
    <div className="performance-console-head">
      <div><span className="section-kicker">{c("My time", "Zaman kayıtlarım")}</span><h3>{c("Time & attendance self-service", "Zaman & devam self-servis")}</h3><p>{c("Create your own governed draft, submit it for manager approval and follow the payroll-ready lifecycle. Approval and locking remain separated from employee self-service.", "Kendi yönetişimli taslağınızı oluşturun, yönetici onayına gönderin ve bordroya hazır yaşam döngüsünü izleyin. Onay ve kilitleme çalışan self-servisinden ayrıdır.")}</p></div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Identity-bound self-service", "Kimliğe bağlı self-servis")}</span></div>
    </div>
    {notice ? <div className={`performance-notice ${notice.tone}`} role={notice.tone === "ok" ? "status" : "alert"} data-time-result={result?.outcome ?? "invalid"}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}
    {needsReview ? <div className="performance-form" data-time-review>
      <small>{c("Reloading discards unsaved page input. No time action is replayed.", "Yenileme, sayfadaki kaydedilmemiş bilgileri siler. Zaman işlemi tekrar gönderilmez.")}</small>
      <button className="secondary-button" type="button" data-time-reload disabled={reloading} onClick={() => {
        if (reloadLock.current) return;
        reloadLock.current = true; setReloading(true);
        try { window.location.reload(); } catch { reloadLock.current = false; setReloading(false); }
      }}>{c("Reload and review", "Yenile ve kontrol et")}</button>
    </div> : null}
    {!data.schedule ? <div className="performance-notice error"><CircleAlert size={15}/><span>{c("No effective work schedule is assigned. You can save a draft, but submission is blocked until Time Administration assigns an active schedule.", "Etkin çalışma planı atanmamış. Taslak kaydedebilirsiniz ancak Zaman Yönetimi aktif bir plan atayana kadar gönderim engellenir.")}</span></div> : null}

    <div className="performance-create-grid">
      <form className="performance-form" onSubmit={(event) => {
        event.preventDefault();
        if (locked.current || needsReview || !mounted.current) return;
        const form = event.currentTarget, values = new FormData(form);
        const draft = timeDraftFromForm({ employmentId, workDate: values.get("workDate"), startAt: values.get("startAt"), endAt: values.get("endAt"), minutes: values.get("minutes"), overtimeMinutes: values.get("overtimeMinutes") ?? "" });
        if (!draft) { invalidInput(); return; }
        void mutate("new-entry", { kind: "create", draft }, () => form.reset());
      }}>
        <div className="performance-form-title"><CalendarClock size={17}/><div><strong>{c("New time draft", "Yeni zaman taslağı")}</strong><small>{c("Intervals, overlap and overtime integrity are enforced server-side", "Aralık, çakışma ve fazla mesai bütünlüğü sunucu tarafında zorunlu")}</small></div></div>
        <label>{c("Work date", "Çalışma tarihi")}<input name="workDate" type="date" required disabled={blocked}/></label>
        <div className="performance-form-row"><label>{c("Start", "Başlangıç")}<input name="startAt" type="datetime-local" disabled={blocked}/></label><label>{c("End", "Bitiş")}<input name="endAt" type="datetime-local" disabled={blocked}/></label></div>
        <small>{c("Start and end use your browser's local time zone; the assigned schedule remains server-validated.", "Başlangıç ve bitişte tarayıcınızın yerel saat dilimi kullanılır; atanmış plan sunucuda doğrulanır.")}</small>
        <div className="performance-form-row"><label>{c("Worked minutes", "Çalışılan dakika")}<input name="minutes" type="number" min="1" max="1440" step="1" required disabled={blocked}/></label><label>{c("Overtime minutes", "Fazla mesai dakikası")}<input name="overtimeMinutes" type="number" min="0" max="1440" step="1" defaultValue="0" disabled={blocked}/></label></div>
        <button className="create-button" type="submit" disabled={blocked}>{pending === "new-entry" ? c("Saving…", "Kaydediliyor…") : c("Save governed draft", "Yönetişimli taslağı kaydet")}</button>
      </form>
      <div className="performance-form">
        <div className="performance-form-title"><Clock3 size={17}/><div><strong>{c("Effective work schedule", "Etkin çalışma planı")}</strong><small>{c("Required before submission, approval and payroll lock", "Gönderim, onay ve bordro kilidi öncesi zorunlu")}</small></div></div>
        {data.schedule ? <div className="performance-operation-list"><div className="performance-operation"><div className="performance-operation-main"><strong>{data.schedule.code} · {data.schedule.name}</strong><small>{data.schedule.timezone}</small></div><strong>{hours(data.schedule.weeklyMinutes)} / {c("week", "hafta")}</strong></div></div> : <p className="performance-empty">{c("No effective schedule is available.", "Etkin çalışma planı bulunmuyor.")}</p>}
        <div className="mini-rule"><span>{c("Recent worked", "Yakın dönem çalışma")}</span><strong>{hours(data.totals.minutes)}</strong></div>
        <div className="mini-rule"><span>{c("Recent overtime", "Yakın dönem fazla mesai")}</span><strong>{hours(data.totals.overtimeMinutes)}</strong></div>
        <div className="mini-rule"><span>{c("Waiting approval", "Onay bekleyen")}</span><strong>{data.totals.submitted}</strong></div>
        <div className="mini-rule"><span>{c("Payroll locked", "Bordroya kilitli")}</span><strong>{data.totals.locked}</strong></div>
        <small>{c("Up to 60 entries are shown. Totals cover these loaded records, not the complete time history.", "En fazla 60 kayıt gösterilir. Toplamlar yüklenen kayıtları kapsar; tüm zaman geçmişinin toplamı değildir.")}</small>
      </div>
    </div>
    <div className="performance-ops-panel goal-operations">
      <div className="performance-panel-title"><TimerReset size={16}/><div><strong>{c("My recent time entries", "Son zaman kayıtlarım")}</strong><small>{data.entries.length} {c("records", "kayıt")}</small></div></div>
      <div className="growth-lifecycle-list">{data.entries.length ? data.entries.map((row) => <article className="growth-lifecycle-row" key={row.id} data-time-entry-id={row.id}><div className="growth-lifecycle-copy"><strong>{dateOnly(row.workDate)} · {hours(row.minutes)}</strong><small>{timeOnly(row.startAt)} → {timeOnly(row.endAt)} · OT {hours(row.overtimeMinutes)} · {row.source}</small></div><em className={`growth-pill ${row.status.toLowerCase()}`}>{statusLabel(row.status, locale)}</em><div className="growth-lifecycle-actions">{["DRAFT", "REJECTED"].includes(row.status) ? <button className="secondary-button" type="button" data-time-submit disabled={blocked || !data.schedule} onClick={() => submitEntry(row)}>{pending === `submit-${row.id}` ? "…" : <><Send size={13}/> {c("Submit", "Gönder")}</>}</button> : null}</div></article>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No recent time entries.", "Yakın tarihli zaman kaydı yok.")}</span></div>}</div>
    </div>
  </section>;
}
