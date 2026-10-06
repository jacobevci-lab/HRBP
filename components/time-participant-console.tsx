"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, CircleAlert, Clock3, Send, ShieldCheck, TimerReset } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { TimeParticipantData } from "@/lib/time-participant-data";
import { submitTimeAction, timeActionMessage, type TimeClientAction } from "@/lib/time-client-action";

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
function iso(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function TimeParticipantConsole({ employmentId, data }: { employmentId: string; data: TimeParticipantData }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const pendingRef = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function mutate(key: string, action: TimeClientAction) {
    if (pendingRef.current || uncertain) return false;
    pendingRef.current = true;
    setPending(key);
    setNotice(null);
    try {
      const result = await submitTimeAction(action);
      if (result.outcome === "saved") {
        setNotice({ tone: "ok", text: timeActionMessage(result, locale) });
        window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
        router.refresh();
        return true;
      }
      setNotice({ tone: "error", text: timeActionMessage(result, locale) });
      if (result.outcome === "unknown") setUncertain(true);
      return false;
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }

  return <section className="performance-console card growth-lifecycle-console">
    <div className="performance-console-head">
      <div><span className="section-kicker">{c("My time", "Zaman kayıtlarım")}</span><h3>{c("Time & attendance self-service", "Zaman & devam self-servis")}</h3><p>{c("Create your own governed draft, submit it for manager approval and follow the payroll-ready lifecycle. Approval and locking remain separated from employee self-service.", "Kendi yönetişimli taslağınızı oluşturun, yönetici onayına gönderin ve bordroya hazır yaşam döngüsünü izleyin. Onay ve kilitleme çalışan self-servisinden ayrıdır.")}</p></div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Identity-bound self-service", "Kimliğe bağlı self-servis")}</span></div>
    </div>

    {notice ? <div className={`performance-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span><span>{notice.text}</span>{uncertain ? <button className="secondary-button" type="button" onClick={() => window.location.reload()}>{c("Reload and check records", "Yenile ve kayıtları kontrol et")}</button> : null}</div> : null}
    {!data.schedule ? <div className="performance-notice error"><CircleAlert size={15}/><span>{c("No effective work schedule is assigned. You can save a draft, but submission is blocked until Time Administration assigns an active schedule.", "Etkin çalışma planı atanmamış. Taslak kaydedebilirsiniz ancak Time Administration aktif bir plan atayana kadar gönderim engellenir.")}</span></div> : null}

    <div className="performance-create-grid">
      <form className="performance-form" onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const startAt = iso(values.get("startAt"));
        const endAt = iso(values.get("endAt"));
        void mutate("new-entry", { kind: "create", input: {
          employmentId,
          workDate: String(values.get("workDate") || ""),
          startAt,
          endAt,
          minutes: String(values.get("minutes") || ""),
          overtimeMinutes: String(values.get("overtimeMinutes") || "0")
        } }).then((ok) => { if (ok) form.reset(); });
      }}>
        <div className="performance-form-title"><CalendarClock size={17}/><div><strong>{c("New time draft", "Yeni zaman taslağı")}</strong><small>{c("Intervals, overlap and overtime integrity are enforced server-side", "Aralık, çakışma ve fazla mesai bütünlüğü sunucu tarafında zorunlu")}</small></div></div>
        <label>{c("Work date", "Çalışma tarihi")}<input name="workDate" type="date" required/></label>
        <div className="performance-form-row"><label>{c("Start", "Başlangıç")}<input name="startAt" type="datetime-local"/></label><label>{c("End", "Bitiş")}<input name="endAt" type="datetime-local"/></label></div>
        <div className="performance-form-row"><label>{c("Worked minutes", "Çalışılan dakika")}<input name="minutes" type="number" min="1" max="1440" step="1" required/></label><label>{c("Overtime minutes", "Fazla mesai dakikası")}<input name="overtimeMinutes" type="number" min="0" max="1440" step="1" defaultValue="0"/></label></div>
        <button className="create-button" disabled={pending !== null || uncertain}>{pending === "new-entry" ? c("Saving…", "Kaydediliyor…") : c("Save governed draft", "Yönetişimli taslağı kaydet")}</button>
      </form>

      <div className="performance-form">
        <div className="performance-form-title"><Clock3 size={17}/><div><strong>{c("Effective work schedule", "Etkin çalışma planı")}</strong><small>{c("Required before submission, approval and payroll lock", "Gönderim, onay ve bordro kilidi öncesi zorunlu")}</small></div></div>
        {data.schedule ? <div className="performance-operation-list"><div className="performance-operation"><div className="performance-operation-main"><strong>{data.schedule.code} · {data.schedule.name}</strong><small>{data.schedule.timezone}</small></div><strong>{hours(data.schedule.weeklyMinutes)} / {c("week", "hafta")}</strong></div></div> : <p className="performance-empty">{c("No effective schedule is available.", "Etkin çalışma planı bulunmuyor.")}</p>}
        <div className="mini-rule"><span>{c("Recent worked", "Yakın dönem çalışma")}</span><strong>{hours(data.totals.minutes)}</strong></div>
        <div className="mini-rule"><span>{c("Recent overtime", "Yakın dönem fazla mesai")}</span><strong>{hours(data.totals.overtimeMinutes)}</strong></div>
        <div className="mini-rule"><span>{c("Waiting approval", "Onay bekleyen")}</span><strong>{data.totals.submitted}</strong></div>
        <div className="mini-rule"><span>{c("Payroll locked", "Bordroya kilitli")}</span><strong>{data.totals.locked}</strong></div>
      </div>
    </div>

    <div className="performance-ops-panel goal-operations">
      <div className="performance-panel-title"><TimerReset size={16}/><div><strong>{c("My recent time entries", "Son zaman kayıtlarım")}</strong><small>{data.entries.length} {c("records", "kayıt")}</small></div></div>
      <div className="growth-lifecycle-list">{data.entries.length ? data.entries.map((row) => <article className="growth-lifecycle-row" key={row.id}><div className="growth-lifecycle-copy"><strong>{dateOnly(row.workDate)} · {hours(row.minutes)}</strong><small>{timeOnly(row.startAt)} → {timeOnly(row.endAt)} · OT {hours(row.overtimeMinutes)} · {row.source}</small></div><em className={`growth-pill ${row.status.toLowerCase()}`}>{statusLabel(row.status, locale)}</em><div className="growth-lifecycle-actions">{["DRAFT", "REJECTED"].includes(row.status) ? <button className="secondary-button" type="button" disabled={pending !== null || uncertain || !data.schedule} onClick={() => void mutate(`submit-${row.id}`, { kind: "transition", entryId: row.id, status: "SUBMITTED" })}>{pending === `submit-${row.id}` ? "…" : <><Send size={13}/> {c("Submit", "Gönder")}</>}</button> : null}</div></article>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No recent time entries.", "Yakın tarihli zaman kaydı yok.")}</span></div>}</div>
    </div>
  </section>;
}
