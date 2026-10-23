"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "pending" | "saved" | "unknown" | "denied" | "conflict" | "rejected" | "capacity";
type Outcome = { phase: Phase; action: string };
type Options = { action: string; confirmation: string; url: string; body: unknown; expectedStatus: number;
  isApplicable?: () => boolean; accepts: (value: unknown) => boolean; afterSave?: (isCurrent: () => boolean) => void };

/** Mounted-component duplicate/receipt guard, NOT durable server idempotency.
 * No request bodies, reply text or credentials are retained in the outcome map.
 */
export function useHRServiceAction(key: string, allowed: boolean) {
  const router = useRouter();
  const latest = useRef({ key, allowed }), mounted = useRef(true);
  const outcomes = useRef(new Map<string, Outcome>()), pending = useRef(false);
  const [, redraw] = useState(0);
  latest.current = { key, allowed };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isCurrent = () => mounted.current && latest.current.key === key && latest.current.allowed;
  const render = () => { if (mounted.current) redraw(n => n + 1); };
  const current = outcomes.current.get(key) ?? { phase: "idle" as const, action: "" };
  const full = !outcomes.current.has(key) && outcomes.current.size >= 32;

  async function run(options: Options): Promise<unknown | null> {
    if (!isCurrent() || options.isApplicable?.() === false || pending.current || outcomes.current.has(key) || outcomes.current.size >= 32) return null;
    pending.current = true; // synchronous: protects calls before React re-renders
    try {
      if (!window.confirm(options.confirmation) || !isCurrent() || options.isApplicable?.() === false) { pending.current = false; render(); return null; }
    } catch { pending.current = false; render(); return null; }
    outcomes.current.set(key, { phase: "pending", action: options.action }); render();
    let phase: Phase = "unknown", accepted: unknown = null;
    try {
      const response = await fetch(options.url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(options.body), credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(20_000) });
      if (response.status === options.expectedStatus && !response.redirected) {
        const envelope: unknown = await response.json();
        if (isObject(envelope) && options.accepts(envelope.data)) { phase = "saved"; accepted = envelope.data; }
      } else if ([401, 403].includes(response.status)) phase = "denied";
      else if ([404, 409, 428].includes(response.status)) phase = "conflict";
      else if ([400, 422, 429].includes(response.status)) phase = "rejected";
    } catch { /* Timeout/transport/invalid receipts are unknown, never a rollback assertion. */ }
    outcomes.current.set(key, { phase, action: options.action }); pending.current = false; render();
    if (!isCurrent() || phase !== "saved") return null;
    // Receipt remains saved if badge cleanup or refresh fails. Neither can retry the POST.
    try { options.afterSave?.(isCurrent); } catch { /* Explicit reload remains available. */ }
    try { window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed")); } catch { /* Best effort. */ }
    try { router.refresh(); } catch { /* Confirmed write is not undone by a render error. */ }
    return accepted;
  }
  return { phase: full ? "capacity" as const : current.phase, action: current.action, run,
    blocked: !allowed || pending.current || outcomes.current.has(key) || full,
    // This clears ONLY a confirmed save following explicit user intent. It is
    // never offered for unknown outcomes and is not a retry of the old request.
    newDraft: () => {
      if (!isCurrent() || pending.current || outcomes.current.get(key)?.phase !== "saved") return false;
      outcomes.current.delete(key); render(); return true;
    }, reload: () => window.location.reload() };
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function serviceActionMessage(phase: Phase, locale: string) {
  const tr = locale === "tr";
  switch (phase) {
    case "saved": return tr ? "İşlem kaydedildi. Güncel kaydı kontrol edebilirsiniz." : "The action was saved. You can check the current record.";
    case "unknown": return tr ? "İşlem sonucu doğrulanamadı. Tekrar göndermeden önce güncel kaydı yeniden yükleyip kontrol edin." : "The result could not be confirmed. Reload and check the current record before submitting again.";
    case "denied": return tr ? "Oturum veya yetki bu işleme izin vermiyor. Erişiminizi yeniden doğrulayın." : "Your session or permissions do not allow this action. Verify your access again.";
    case "conflict": return tr ? "Talep değişmiş veya bu kapsamda bulunamıyor. Güncel kaydı yeniden yükleyin." : "The request changed or is unavailable in this scope. Reload the current record.";
    case "rejected": return tr ? "İşlem kabul edilmedi. Yeniden göndermeden önce bilgileri ve güncel kaydı kontrol edin." : "The action was not accepted. Check the details and current record before submitting again.";
    case "capacity": return tr ? "Yeni işlemden önce güncel kayıtları yeniden yükleyin." : "Reload the current records before another action.";
    default: return "";
  }
}
