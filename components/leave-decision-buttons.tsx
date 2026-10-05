"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { acknowledgeLeaveNotification, submitLeaveAction, type LeaveActionResult } from "@/lib/leave-client-action";

type Decision = "APPROVED" | "REJECTED";

// A different record always owns a fresh lock; late replies cannot affect its controls.
export function LeaveDecisionButtons({ requestId }: { requestId: string }) {
  return <LeaveDecisionControl key={requestId} requestId={requestId}/>;
}

function LeaveDecisionControl({ requestId }: { requestId: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [busy, setBusy] = useState<Decision | null>(null);
  const [result, setResult] = useState<LeaveActionResult | null>(null);
  const [reloading, setReloading] = useState(false);
  const locked = useRef(false);
  const reloadLock = useRef(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  async function decide(decision: Decision) {
    if (locked.current) return;
    // Lock before confirmation as well as before the first await.
    locked.current = true;
    if (!window.confirm(decision === "APPROVED"
      ? c("Approve this leave request? Its tracked balance will be reserved.", "Bu izin talebi onaylansın mı? Takip edilen izin bakiyesinden düşülecek.")
      : c("Reject this leave request? This decision will be recorded.", "Bu izin talebi reddedilsin mi? Bu karar kayda alınacak."))) {
      locked.current = false;
      return;
    }
    setBusy(decision);
    controller.current = new AbortController();
    let outcome: LeaveActionResult;
    try {
      outcome = await submitLeaveAction({ kind: "decision", requestId, decision }, { signal: controller.current.signal });
    } catch { outcome = { outcome: "unknown" }; }
    if (!mounted.current) return;
    setBusy(null);
    setResult(outcome);
    // Every attempted decision seals this row until a fresh page read. In particular,
    // a conflict is not permission to send the opposite decision on a stale row.
    if (outcome.outcome !== "saved") return;
    void acknowledgeLeaveNotification(requestId).then((acknowledged) => {
      if (acknowledged && mounted.current) window.dispatchEvent(new Event("hrbp:notifications-changed"));
    }).catch(() => {});
    try {
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      router.refresh();
    } catch {
      // A refresh/event failure does not undo a confirmed database decision.
    }
  }

  const message = !result ? "" : result.outcome === "saved"
    ? result.status === "APPROVED"
      ? c("Approval confirmed by the server.", "Onay işlemi sunucu yanıtıyla doğrulandı.")
      : c("Rejection confirmed by the server.", "Ret işlemi sunucu yanıtıyla doğrulandı.")
    : result.outcome === "unknown"
      ? c("The decision could not be confirmed; it may have been saved. No automatic retry was made. Reload and review the current record before another decision.", "Kararın sonucu doğrulanamadı; kaydedilmiş olabilir. Otomatik tekrar gönderilmedi. Yeni karar vermeden önce sayfayı yenileyip güncel kaydı kontrol edin.")
      : result.status === 401
        ? c("Your session could not be verified. Reload and sign in again.", "Oturum doğrulanamadı. Sayfayı yenileyip yeniden giriş yapın.")
        : result.status === 403
          ? c("This decision is not authorized. Reload to check your current access.", "Bu karar için yetkiniz yok. Güncel erişiminizi kontrol etmek için yenileyin.")
          : result.status === 409
            ? c("The request state or available balance conflicts with this decision. Reload before taking another action.", "Talep durumu veya kullanılabilir bakiye bu kararla çakışıyor. Yeni işlemden önce yenileyin.")
            : c("The decision was not accepted. Reload and review the current request.", "Karar kabul edilmedi. Sayfayı yenileyip güncel talebi kontrol edin.");

  return <div data-leave-decision-id={requestId} style={{ display: "grid", gap: 5, maxWidth: 260 }} aria-busy={busy !== null}>
    {!result ? <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      <button type="button" className="secondary-button" data-decision="APPROVED" disabled={busy !== null} onClick={() => void decide("APPROVED")}><Check size={14}/>{busy === "APPROVED" ? c("Saving…", "Kaydediliyor…") : c("Approve", "Onayla")}</button>
      <button type="button" className="secondary-button" data-decision="REJECTED" disabled={busy !== null} onClick={() => void decide("REJECTED")}><X size={14}/>{busy === "REJECTED" ? c("Saving…", "Kaydediliyor…") : c("Reject", "Reddet")}</button>
    </div> : <>
      <small role={result.outcome === "saved" ? "status" : "alert"} data-leave-decision-result={result.outcome}>{message}</small>
      <small>{c("Reloading discards unsaved page input; no decision is replayed.", "Yenileme, sayfadaki kaydedilmemiş bilgileri siler; karar tekrar gönderilmez.")}</small>
      <button type="button" className="secondary-button" data-leave-decision-reload disabled={reloading} onClick={() => {
        if (reloadLock.current) return;
        reloadLock.current = true; setReloading(true);
        try { window.location.reload(); } catch { reloadLock.current = false; setReloading(false); }
      }}>{c("Reload and review", "Yenile ve kontrol et")}</button>
    </>}
  </div>;
}
