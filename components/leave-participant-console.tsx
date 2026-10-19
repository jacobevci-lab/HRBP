"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CheckCircle2, CircleAlert, ShieldCheck, WalletCards } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { leaveActionMessage, submitLeaveAction, type LeaveClientAction, type LeaveActionResult } from "@/lib/leave-client-action";
import type { LeaveParticipantData } from "@/lib/leave-participant-data";

type UnitSelection = { id: string; unit: "DAYS" | "HOURS" };
function supportedUnit(value: string): value is UnitSelection["unit"] {
  return value === "DAYS" || value === "HOURS";
}
function unitLabel(unit: string | undefined, locale: "en" | "tr") {
  if (unit === "DAYS") return locale === "tr" ? "gün" : "days";
  if (unit === "HOURS") return locale === "tr" ? "saat" : "hours";
  return locale === "tr" ? "birim seçilmedi" : "unit not selected";
}

function dateOnly(value: string) { return value.slice(0, 10); }
function statusLabel(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = { PENDING: "Onay bekliyor", APPROVED: "Onaylandı", REJECTED: "Reddedildi", CANCELLED: "İptal", TAKEN: "Kullanıldı", DRAFT: "Taslak" };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function LeaveParticipantContent({ employmentId, data }: { employmentId: string; data: LeaveParticipantData }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<LeaveActionResult | null>(null);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const locked = useRef(false);
  const needsReview = useRef(false);
  const alive = useRef(true);
  const currentRequest = useRef<AbortController | null>(null);
  const reloadStarted = useRef(false);
  const [cancelledIds, setCancelledIds] = useState<string[]>([]);
  const blocked = pending !== null || reviewRequired || reloading;
  const [selection, setSelection] = useState<UnitSelection | null>(null);
  const selected = useRef<UnitSelection | null>(null);
  const currentTypes = useRef(data.leaveTypes); currentTypes.current = data.leaveTypes;
  const [unitChanged, setUnitChanged] = useState(false);
  const unitHelpId = useId();
  // Bind the entered quantity to its displayed unit, not just a type ID. A
  // refreshed catalogue cannot silently reinterpret days as hours or vice versa.
  const selectedType = data.leaveTypes.find(type => type.id === selection?.id &&
    type.unit === selection?.unit && supportedUnit(type.unit));
  function resetSelection() {
    selected.current = null; setSelection(null); setUnitChanged(false);
  }

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; currentRequest.current?.abort(); };
  }, []);

  async function request(key: string, action: LeaveClientAction) {
    // A ref closes the same-event-loop gap before React updates disabled controls.
    if (locked.current || needsReview.current || reloadStarted.current) return false;
    locked.current = true;
    const controller = new AbortController();
    currentRequest.current = controller;
    setPending(key);
    setNotice(null);
    setRefreshFailed(false);
    try {
      const result = await submitLeaveAction(action, { signal: controller.signal });
      if (!alive.current) return false;
      setNotice(result);
      if (result.outcome === "unknown") {
        needsReview.current = true;
        setReviewRequired(true);
        return false;
      }
      if (result.outcome !== "saved") return false;
      if (action.kind === "cancel") setCancelledIds((ids) => [...ids, result.id]);
      // A refresh error must not reclassify an already confirmed write as a failure.
      try { router.refresh(); } catch { setRefreshFailed(true); }
      return true;
    } finally {
      locked.current = false;
      currentRequest.current = null;
      if (alive.current) setPending(null);
    }
  }

  function reload() {
    if (locked.current || reloadStarted.current) return;
    reloadStarted.current = true;
    setReloading(true);
    setReloadFailed(false);
    try { window.location.reload(); }
    catch { reloadStarted.current = false; setReloading(false); setReloadFailed(true); }
  }

  return <section className="performance-console card growth-lifecycle-console" data-leave-self-service="true" aria-busy={pending !== null}>
    <div className="performance-console-head">
      <div><span className="section-kicker">{c("My leave", "İzinlerim")}</span><h3>{c("Leave self-service", "İzin self-servis")}</h3><p>{c("Create leave for your own employment identity, see governed balances and cancel pending or approved requests. Approval decisions remain separated from employee self-service.", "Yalnız kendi istihdam kimliğiniz için izin oluşturun, yönetişimli bakiyelerinizi görün ve bekleyen/onaylı talepleri iptal edin. Onay kararları çalışan self-servisinden ayrıdır.")}</p></div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Self-service boundary active", "Self-servis sınırı aktif")}</span></div>
    </div>

    {notice ? <div className={`performance-notice ${notice.outcome === "saved" ? "ok" : "error"}`} role={notice.outcome === "saved" ? "status" : "alert"} data-leave-result={notice.outcome}><span>{notice.outcome === "saved" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{leaveActionMessage(notice, locale)}</div> : null}
    {reviewRequired || refreshFailed ? <div className="performance-form" data-leave-recovery="true">
      {refreshFailed ? <p>{c("The write was confirmed, but refreshing the view failed. Reload to review current records; unsaved form input will be lost.", "İşlem doğrulandı ancak görünüm yenilenemedi. Güncel kayıtları görmek için yeniden yükleyin; kaydedilmemiş form bilgileri silinecek.")}</p> : null}
      <button className="secondary-button" type="button" disabled={reloading || pending !== null} aria-busy={reloading} onClick={reload}>{reloading ? c("Reloading…", "Yeniden yükleniyor…") : c("Reload and check requests", "Yenile ve talepleri kontrol et")}</button>
      {reloadFailed ? <p role="alert">{c("Reload did not start. Use your browser's reload control before submitting again.", "Yenileme başlatılamadı. Yeniden işlem yapmadan önce tarayıcının yenileme düğmesini kullanın.")}</p> : null}
    </div> : null}

    <div className="performance-create-grid">
      <form className="performance-form" onReset={resetSelection} onSubmit={(event) => {
        event.preventDefault();
        if (locked.current || needsReview.current || reloadStarted.current) return;
        const form = event.currentTarget;
        const values = new FormData(form);
        const field = (name: string) => { const value = values.get(name); return typeof value === "string" ? value : ""; };
        const chosen = currentTypes.current.find(type => type.id === field("leaveTypeId"));
        if (!chosen || !supportedUnit(chosen.unit) || selected.current?.id !== chosen.id ||
            selected.current.unit !== chosen.unit) return;
        void request("new-leave", { kind: "create", input: {
          employmentId,
          leaveTypeId: field("leaveTypeId"),
          startsAt: field("startsAt"),
          endsAt: field("endsAt"),
          units: field("units"),
          reason: field("reason") || undefined
        } }).then((ok) => { if (ok && form.isConnected) form.reset(); });
      }}>
        <div className="performance-form-title"><CalendarDays size={17}/><div><strong>{c("New leave request", "Yeni izin talebi")}</strong><small>{c("Overlap and balance controls are enforced server-side", "Çakışma ve bakiye kontrolleri sunucu tarafında zorunlu")}</small></div></div>
        <label>{c("Leave type", "İzin türü")}<select name="leaveTypeId" required disabled={blocked} value={selectedType ? selection?.id ?? "" : ""} onChange={event => {
          const select = event.currentTarget;
          const next = currentTypes.current.find(type => type.id === select.value);
          const previous = selected.current;
          if (locked.current || needsReview.current || reloadStarted.current || !next || !supportedUnit(next.unit)) {
            select.value = previous?.id ?? ""; return;
          }
          const quantity = select.form?.elements.namedItem("units") as HTMLInputElement | null;
          const changesUnit = Boolean(previous && previous.unit !== next.unit);
          if (changesUnit && quantity?.value && !window.confirm(c(
            `Change from ${unitLabel(previous?.unit, "en")} to ${unitLabel(next.unit, "en")}? The amount will be cleared, not converted. Dates and reason will stay.`,
            `${unitLabel(previous?.unit, "tr")} yerine ${unitLabel(next.unit, "tr")} seçilsin mi? Miktar dönüştürülmeden temizlenecek. Tarihler ve açıklama korunacak.`
          ))) { select.value = previous?.id ?? ""; return; }
          if (changesUnit && quantity) quantity.value = "";
          selected.current = { id: next.id, unit: next.unit };
          setSelection(selected.current); setUnitChanged(changesUnit);
        }}><option value="" disabled>{c("Select leave type", "İzin türü seçin")}</option>{data.leaveTypes.map((type) => <option key={type.id} value={type.id} disabled={!supportedUnit(type.unit)}>{type.code} · {type.name} · {unitLabel(type.unit, locale)}{type.requiresApproval ? "" : ` · ${c("auto approval", "otomatik onay")}`}</option>)}</select></label>
        <div className="performance-form-row"><label>{c("Starts", "Başlangıç")}<input name="startsAt" type="date" required disabled={blocked}/></label><label>{c("Ends", "Bitiş")}<input name="endsAt" type="date" required disabled={blocked}/></label></div>
        <label>{selectedType ? c(`Amount (${unitLabel(selectedType.unit, "en")})`, `Miktar (${unitLabel(selectedType.unit, "tr")})`) : c("Amount — select a leave type", "Miktar — izin türü seçin")}<input name="units" type="number" min="0.01" max="366" step="0.01" required disabled={blocked || !selectedType} aria-describedby={unitHelpId} data-leave-unit={selectedType?.unit ?? ""}/></label>
        <div id={unitHelpId} data-leave-unit-help role="status" aria-live="polite">
          <small>{selectedType ? c(
            `Enter the amount in ${unitLabel(selectedType.unit, "en")}. The date range does not automatically calculate working days, holidays or hours. No day/hour conversion is performed.`,
            `Miktarı ${unitLabel(selectedType.unit, "tr")} olarak girin. Tarih aralığından çalışma günleri, tatiller veya saatler otomatik hesaplanmaz. Gün/saat dönüşümü yapılmaz.`
          ) : c("Select an available leave type to verify its unit before entering an amount.", "Miktar girmeden önce kullanılabilir bir izin türü seçerek birimini doğrulayın.")}</small>
          {unitChanged ? <p>{c("The unit changed. Enter a new amount; your dates and reason are retained.", "Birim değişti. Yeni miktarı girin; tarihleriniz ve açıklamanız korundu.")}</p> : null}
          {selection && !selectedType ? <p>{c("The selected type is unavailable or its unit changed. Reselect a current type before submitting.", "Seçilen tür kullanılamıyor veya birimi değişti. Göndermeden önce güncel bir türü yeniden seçin.")}</p> : null}
          {selectedType && !selectedType.requiresApproval ? <p>{c("This type is automatically approved if the server's overlap and balance checks pass.", "Bu tür, sunucudaki çakışma ve bakiye kontrolleri geçerse otomatik onaylanır.")}</p> : null}
        </div>
        <label>{c("Reason", "Açıklama")}<textarea name="reason" rows={2} maxLength={2000} disabled={blocked}/></label>
        <button className="create-button" type="submit" disabled={blocked || !selectedType}>{pending === "new-leave" ? c("Submitting…", "Gönderiliyor…") : c("Submit leave request", "İzin talebini gönder")}</button>
      </form>

      <div className="performance-form">
        <div className="performance-form-title"><WalletCards size={17}/><div><strong>{c("Current balances", "Güncel bakiyeler")}</strong><small>{c("Opening + accrual + adjustment − used", "Açılış + tahakkuk + düzeltme − kullanılan")}</small></div></div>
        <div className="performance-operation-list">{data.balances.length ? data.balances.map((balance) => <div className="performance-operation" key={`${balance.leaveTypeId}-${balance.year}`}><div className="performance-operation-main"><strong>{balance.leaveType}</strong><small>{balance.year}</small></div><strong>{balance.remaining.toFixed(2)}</strong></div>) : <p className="performance-empty">{c("No current-year balance records are available.", "Güncel yıl için izin bakiyesi bulunmuyor.")}</p>}</div>
      </div>
    </div>

    <div className="performance-ops-panel goal-operations">
      <div className="performance-panel-title"><CalendarDays size={16}/><div><strong>{c("My recent requests", "Son izin taleplerim")}</strong><small>{data.requests.length} {c("records (up to 50)", "kayıt (en fazla 50)")}</small></div></div>
      <div className="growth-lifecycle-list">{data.requests.length ? data.requests.map((row) => <article className="growth-lifecycle-row" key={row.id} data-leave-request-id={row.id}><div className="growth-lifecycle-copy"><strong>{row.leaveType}</strong><small>{dateOnly(row.startsAt)} → {dateOnly(row.endsAt)} · {row.units} {locale === "tr" ? (row.unit === "HOURS" ? "saat" : "gün") : row.unit.toLowerCase()}</small></div><em className={`growth-pill ${row.status.toLowerCase()}`}>{statusLabel(row.status, locale)}</em><div className="growth-lifecycle-actions">{["PENDING", "APPROVED"].includes(row.status) && !cancelledIds.includes(row.id) ? <button className="secondary-button" type="button" disabled={blocked} onClick={() => {
        if (locked.current || needsReview.current || reloadStarted.current) return;
        if (window.confirm(c("Cancel this leave request? Approved leave will restore its governed balance.", "Bu izin talebi iptal edilsin mi? Onaylı iznin yönetişimli bakiyesi geri yüklenecek."))) void request(`cancel-${row.id}`, { kind: "cancel", employmentId, requestId: row.id });
      }}>{pending === `cancel-${row.id}` ? "…" : c("Cancel", "İptal et")}</button> : null}</div></article>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No recent leave requests.", "Yakın tarihli izin talebi yok.")}</span></div>}</div>
    </div>
  </section>;
}

export function LeaveParticipantConsole(props: { employmentId: string; data: LeaveParticipantData }) {
  // A changed employment must not inherit another identity's draft, notices or pending response.
  return <LeaveParticipantContent key={props.employmentId} {...props}/>;
}
