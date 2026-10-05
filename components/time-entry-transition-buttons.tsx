"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, LockKeyhole, X } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { acknowledgeTimeNotification, isTimeTarget, submitTimeTransition, timeActionMessage, type TimeActionResult, type TimeTarget } from "@/lib/time-client-action";

type TimeStatus = "DRAFT" | TimeTarget;
type Props = { entryId: string; targets: TimeStatus[] };
const labels = {
  SUBMITTED: ["Submit", "Gönder"], APPROVED: ["Approve", "Onayla"],
  REJECTED: ["Reject", "Reddet"], LOCKED: ["Lock", "Kilitle"]
} as const;

function Icon({ status }: { status: TimeTarget }) {
  if (status === "APPROVED") return <Check size={13}/>;
  if (status === "REJECTED") return <X size={13}/>;
  if (status === "LOCKED") return <LockKeyhole size={13}/>;
  return <ArrowRight size={13}/>;
}

// A different record owns a fresh control. Old responses cannot mutate the new row.
export function TimeEntryTransitionButtons(props: Props) {
  return <TimeEntryTransitionControl key={props.entryId} {...props}/>;
}

function TimeEntryTransitionControl({ entryId, targets }: Props) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [busy, setBusy] = useState<TimeTarget | null>(null);
  const [result, setResult] = useState<TimeActionResult | null>(null);
  const [reloading, setReloading] = useState(false);
  const locked = useRef(false), reloadLock = useRef(false), mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const acknowledgement = useRef<AbortController | null>(null);
  const allowed = Array.isArray(targets) && targets.length <= 4 && targets.every(isTimeTarget)
    ? [...new Set(targets as TimeTarget[])] : [];

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); acknowledgement.current?.abort(); };
  }, []);

  async function transition(status: TimeTarget) {
    if (locked.current || !allowed.includes(status)) return;
    locked.current = true;
    const confirm = status === "LOCKED"
      ? c("Lock this time entry for payroll consumption? The approving actor must be different.", "Bu zaman kaydı bordro kullanımı için kilitlensin mi? Onaylayan kişi farklı olmalıdır.")
      : status === "APPROVED"
        ? c("Approve this time entry? This decision will be recorded.", "Bu zaman kaydı onaylansın mı? Karar kayda alınacak.")
        : status === "REJECTED"
          ? c("Reject this time entry? This decision will be recorded.", "Bu zaman kaydı reddedilsin mi? Karar kayda alınacak.")
          : c("Submit this time entry for approval? Schedule and time integrity will be checked.", "Bu zaman kaydı onaya gönderilsin mi? Çalışma planı ve zaman bütünlüğü kontrol edilecek.");
    if (!window.confirm(confirm)) { locked.current = false; return; }
    setBusy(status);
    controller.current = new AbortController();
    let outcome: TimeActionResult;
    try { outcome = await submitTimeTransition(entryId, status, { signal: controller.current.signal }); }
    catch { outcome = { outcome: "unknown" }; }
    if (!mounted.current) return;
    setBusy(null); setResult(outcome);
    // All attempted transitions seal this row, including conflicts. Never replay blindly.
    if (outcome.outcome !== "saved") return;
    if (status === "APPROVED" || status === "REJECTED") {
      acknowledgement.current = new AbortController();
      void acknowledgeTimeNotification(entryId, { signal: acknowledgement.current.signal }).then((ok) => {
        if (ok && mounted.current) window.dispatchEvent(new Event("hrbp:notifications-changed"));
      }).catch(() => {});
    }
    try { window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed")); router.refresh(); }
    catch { /* A refresh failure cannot undo a verified transition or reopen the row. */ }
  }

  return <div data-time-transition-id={entryId} style={{ display: "grid", gap: 5, minWidth: 112, maxWidth: 260 }} aria-busy={busy !== null}>
    {result ? <>
      <small role={result.outcome === "saved" ? "status" : "alert"} data-time-transition-result={result.outcome}>{timeActionMessage(result, locale)}</small>
      <small>{c("Reloading discards unsaved page input; no transition is replayed.", "Yenileme, sayfadaki kaydedilmemiş bilgileri siler; işlem tekrar gönderilmez.")}</small>
      <button type="button" className="secondary-button" data-time-transition-reload disabled={reloading} onClick={() => {
        if (reloadLock.current) return;
        reloadLock.current = true; setReloading(true);
        try { window.location.reload(); } catch { reloadLock.current = false; setReloading(false); }
      }}>{c("Reload and review", "Yenile ve kontrol et")}</button>
    </> : allowed.length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
      {allowed.map((status) => <button type="button" key={status} data-time-target={status} className="secondary-button" disabled={busy !== null} onClick={() => void transition(status)}>{busy === status ? c("Saving…", "Kaydediliyor…") : labels[status][locale === "tr" ? 1 : 0]} <Icon status={status}/></button>)}
    </div> : <span style={{ color: "var(--muted)" }}>—</span>}
  </div>;
}
