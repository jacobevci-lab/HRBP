"use client";

import { useRef, useState } from "react";
import { ArrowRight, Check, LockKeyhole, RotateCcw, X } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { acknowledgeTimeNotification, submitTimeAction, timeActionMessage, type TimeStatus } from "@/lib/time-client-action";

function label(status: TimeStatus, locale: "en" | "tr") {
  const tr = locale === "tr";
  if (status === "SUBMITTED") return tr ? "Gönder" : "Submit";
  if (status === "APPROVED") return tr ? "Onayla" : "Approve";
  if (status === "REJECTED") return tr ? "Reddet" : "Reject";
  if (status === "LOCKED") return tr ? "Bordroya kilitle" : "Lock";
  return tr ? "Taslağa döndür" : "Return to draft";
}

function Icon({ status }: { status: TimeStatus }) {
  if (status === "APPROVED") return <Check size={13}/>;
  if (status === "REJECTED") return <X size={13}/>;
  if (status === "LOCKED") return <LockKeyhole size={13}/>;
  if (status === "DRAFT") return <RotateCcw size={13}/>;
  return <ArrowRight size={13}/>;
}

export function TimeEntryTransitionButtons({ entryId, targets }: { entryId: string; targets: TimeStatus[] }) {
  const { locale } = useLocale();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<TimeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  if (!targets.length) return <span style={{ color: "var(--muted)" }}>—</span>;

  async function transition(status: TimeStatus) {
    if (busyRef.current || uncertain) return;
    const confirmed = window.confirm(locale === "tr"
      ? `Bu zaman kaydını “${label(status, locale)}” durumuna geçirmek istiyor musunuz?`
      : `Move this time entry to “${label(status, locale)}”?`);
    if (!confirmed || busyRef.current) return;
    busyRef.current = true;
    setBusy(status);
    setError(null);
    try {
      const result = await submitTimeAction({ kind: "transition", entryId, status });
      if (result.outcome === "saved") {
        if (status === "APPROVED" || status === "REJECTED") await acknowledgeTimeNotification(entryId);
        window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
        window.dispatchEvent(new Event("hrbp:notifications-changed"));
        window.location.reload();
        return;
      }
      setError(timeActionMessage(result, locale));
      if (result.outcome === "unknown") setUncertain(true);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  if (uncertain) return <div data-time-entry-id={entryId} data-time-transition-result="unknown" style={{ display: "grid", gap: 5, minWidth: 180 }}>
    <small style={{ color: "#b42318", maxWidth: 260 }}>{error}</small>
    <button className="secondary-button" type="button" onClick={() => window.location.reload()}>
      {locale === "tr" ? "Yenile ve kaydı kontrol et" : "Reload and check the entry"}
    </button>
  </div>;

  return <div data-time-entry-id={entryId} style={{ display: "grid", gap: 5, minWidth: 112 }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
      {targets.map((status) => <button key={status} className="secondary-button" data-time-transition={status} disabled={Boolean(busy)} onClick={() => void transition(status)}>{busy === status ? (locale === "tr" ? "Kaydediliyor…" : "Saving…") : label(status, locale)} <Icon status={status}/></button>)}
    </div>
    {error ? <small style={{ color: "#b42318", maxWidth: 260 }}>{error}</small> : null}
  </div>;
}
