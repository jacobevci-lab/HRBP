"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CheckCircle2, CircleAlert, ShieldCheck, WalletCards } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { LeaveParticipantData } from "@/lib/leave-participant-data";

function dateOnly(value: string) { return value.slice(0, 10); }
function statusLabel(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = { PENDING: "Onay bekliyor", APPROVED: "Onaylandı", REJECTED: "Reddedildi", CANCELLED: "İptal", TAKEN: "Kullanıldı", DRAFT: "Taslak" };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export function LeaveParticipantConsole({ employmentId, data }: { employmentId: string; data: LeaveParticipantData }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function request(key: string, url: string, payload?: Record<string, unknown>) {
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: payload ? { "content-type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`, `İstek başarısız (${response.status})`));
      setNotice({ tone: "ok", text: c("Leave action saved and audit evidence written.", "İzin işlemi kaydedildi ve denetim kanıtı yazıldı.") });
      router.refresh();
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Leave action failed.", "İzin işlemi başarısız.") });
      return false;
    } finally {
      setPending(null);
    }
  }

  return <section className="performance-console card growth-lifecycle-console">
    <div className="performance-console-head">
      <div><span className="section-kicker">{c("My leave", "İzinlerim")}</span><h3>{c("Leave self-service", "İzin self-servis")}</h3><p>{c("Create leave for your own employment identity, see governed balances and cancel pending or approved requests. Approval decisions remain separated from employee self-service.", "Yalnız kendi istihdam kimliğiniz için izin oluşturun, yönetişimli bakiyelerinizi görün ve bekleyen/onaylı talepleri iptal edin. Onay kararları çalışan self-servisinden ayrıdır.")}</p></div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Self-service boundary active", "Self-servis sınırı aktif")}</span></div>
    </div>

    {notice ? <div className={`performance-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}

    <div className="performance-create-grid">
      <form className="performance-form" onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        void request("new-leave", "/api/leave/requests", {
          employmentId,
          leaveTypeId: values.get("leaveTypeId"),
          startsAt: values.get("startsAt"),
          endsAt: values.get("endsAt"),
          units: values.get("units"),
          reason: values.get("reason") || undefined
        }).then((ok) => { if (ok) form.reset(); });
      }}>
        <div className="performance-form-title"><CalendarDays size={17}/><div><strong>{c("New leave request", "Yeni izin talebi")}</strong><small>{c("Overlap and balance controls are enforced server-side", "Çakışma ve bakiye kontrolleri sunucu tarafında zorunlu")}</small></div></div>
        <label>{c("Leave type", "İzin türü")}<select name="leaveTypeId" required defaultValue=""><option value="" disabled>{c("Select leave type", "İzin türü seçin")}</option>{data.leaveTypes.map((type) => <option key={type.id} value={type.id}>{type.code} · {type.name}{type.requiresApproval ? "" : ` · ${c("auto approval", "otomatik onay")}`}</option>)}</select></label>
        <div className="performance-form-row"><label>{c("Starts", "Başlangıç")}<input name="startsAt" type="date" required/></label><label>{c("Ends", "Bitiş")}<input name="endsAt" type="date" required/></label></div>
        <label>{c("Units", "Birim")}<input name="units" type="number" min="0.01" max="366" step="0.01" required/></label>
        <label>{c("Reason", "Açıklama")}<textarea name="reason" rows={2} maxLength={2000}/></label>
        <button className="create-button" disabled={pending !== null || !data.leaveTypes.length}>{pending === "new-leave" ? c("Submitting…", "Gönderiliyor…") : c("Submit leave request", "İzin talebini gönder")}</button>
      </form>

      <div className="performance-form">
        <div className="performance-form-title"><WalletCards size={17}/><div><strong>{c("Current balances", "Güncel bakiyeler")}</strong><small>{c("Opening + accrual + adjustment − used", "Açılış + tahakkuk + düzeltme − kullanılan")}</small></div></div>
        <div className="performance-operation-list">{data.balances.length ? data.balances.map((balance) => <div className="performance-operation" key={`${balance.leaveTypeId}-${balance.year}`}><div className="performance-operation-main"><strong>{balance.leaveType}</strong><small>{balance.year}</small></div><strong>{balance.remaining.toFixed(2)}</strong></div>) : <p className="performance-empty">{c("No current-year balance records are available.", "Güncel yıl için izin bakiyesi bulunmuyor.")}</p>}</div>
      </div>
    </div>

    <div className="performance-ops-panel goal-operations">
      <div className="performance-panel-title"><CalendarDays size={16}/><div><strong>{c("My recent requests", "Son izin taleplerim")}</strong><small>{data.requests.length} {c("records", "kayıt")}</small></div></div>
      <div className="growth-lifecycle-list">{data.requests.length ? data.requests.map((row) => <article className="growth-lifecycle-row" key={row.id}><div className="growth-lifecycle-copy"><strong>{row.leaveType}</strong><small>{dateOnly(row.startsAt)} → {dateOnly(row.endsAt)} · {row.units} {row.unit.toLowerCase()}</small></div><em className={`growth-pill ${row.status.toLowerCase()}`}>{statusLabel(row.status, locale)}</em><div className="growth-lifecycle-actions">{["PENDING", "APPROVED"].includes(row.status) ? <button className="secondary-button" type="button" disabled={pending !== null} onClick={() => {
        if (window.confirm(c("Cancel this leave request? Approved leave will restore its governed balance.", "Bu izin talebi iptal edilsin mi? Onaylı iznin yönetişimli bakiyesi geri yüklenecek."))) void request(`cancel-${row.id}`, `/api/leave/requests/${row.id}/self-cancel`);
      }}>{pending === `cancel-${row.id}` ? "…" : c("Cancel", "İptal et")}</button> : null}</div></article>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No recent leave requests.", "Yakın tarihli izin talebi yok.")}</span></div>}</div>
    </div>
  </section>;
}
