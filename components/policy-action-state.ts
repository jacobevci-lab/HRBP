"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "pending" | "saved" | "unknown" | "conflict" | "denied" | "missing" | "rejected";
type Attempt = { key: string; pending: boolean };
type Options = { action: string; confirmation: string; url: string; init: RequestInit; expectedStatus: number; events: readonly string[]; accepts: (data: unknown) => boolean };

/** Local click/receipt safety only, not server idempotency or version locking.
 * An unconfirmed write is never retried. Reload fetches the current server view.
 */
export function usePolicyAction(recordKey: string) {
  const router = useRouter();
  const mounted = useRef(true), latestKey = useRef(recordKey), gate = useRef<Attempt | null>(null);
  const [result, setResult] = useState<{ key: string; phase: Phase; action: string }>({ key: recordKey, phase: "idle", action: "" });
  latestKey.current = recordKey;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function run(options: Options) {
    if (!mounted.current || latestKey.current !== recordKey || gate.current?.pending || gate.current?.key === recordKey) return;
    // Acquire synchronously, before a confirmation or the first awaited call.
    const attempt: Attempt = { key: recordKey, pending: true };
    gate.current = attempt;
    if (!window.confirm(options.confirmation)) {
      gate.current = null;
      setResult({ key: recordKey, phase: "idle", action: "" });
      return;
    }
    setResult({ key: recordKey, phase: "pending", action: options.action });
    let phase: Phase = "unknown";
    try {
      const response = await fetch(options.url, { ...options.init, credentials: "same-origin", redirect: "error" });
      if (response.status === options.expectedStatus && !response.redirected) {
        const value: unknown = await response.json();
        phase = isRecord(value) && options.accepts(value.data) ? "saved" : "unknown";
      } else if (response.status === 401 || response.status === 403) phase = "denied";
      else if (response.status === 409) phase = "conflict";
      else if (response.status === 404) phase = "missing";
      else if (response.status === 400 || response.status === 422 || response.status === 429) phase = "rejected";
      // 5xx, redirects, unexpected 2xx and malformed receipts remain unknown.
      // Never display raw server/transport errors or infer a rollback from them.
    } catch { phase = "unknown"; }
    attempt.pending = false;
    if (!mounted.current || gate.current !== attempt) return;
    if (latestKey.current !== recordKey) {
      gate.current = null;
      setResult({ key: latestKey.current, phase: "idle", action: "" });
      return; // An old response must not update/refresh another visible record.
    }
    setResult({ key: recordKey, phase, action: options.action });
    if (phase === "saved") {
      // A confirmed commit stays confirmed even if notification/refresh fails.
      for (const name of options.events) {
        try { window.dispatchEvent(new Event(name)); } catch { /* Reload remains available. */ }
      }
      try { router.refresh(); } catch { /* Do not unlock and replay a saved action. */ }
    }
  }
  const current = result.key === recordKey ? result : { phase: "idle" as const, action: "" };
  return { ...current, run, blocked: Boolean(gate.current?.pending || gate.current?.key === recordKey),
    reload: () => window.location.reload() };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function policyActionMessage(phase: Phase, locale: string) {
  const tr = locale === "tr";
  switch (phase) {
    case "saved": return tr ? "İşlem kaydedildi. Yeni bir işlemden önce güncel kaydı kontrol edin." : "The action was saved. Check the current record before another change.";
    case "unknown": return tr ? "İşlem sonucu doğrulanamadı. Tekrar göndermeden önce güncel kaydı yeniden yükleyip kontrol edin." : "The result could not be confirmed. Reload and check the current record before submitting again.";
    case "conflict": return tr ? "Politikanın durumu değişmiş veya bu işlem artık uygun değil. Güncel kaydı yeniden yükleyin." : "The policy state changed or this action is no longer allowed. Reload the current record.";
    case "denied": return tr ? "Oturumunuz veya yetkiniz bu işleme izin vermiyor. Erişiminizi yeniden doğrulayın." : "Your session or permissions do not allow this action. Verify your access again.";
    case "missing": return tr ? "Politika veya ilgili kayıt bu kapsamda bulunamadı. Güncel kayıtları yeniden yükleyin." : "The policy or related record was not found in this scope. Reload the current records.";
    case "rejected": return tr ? "İşlem kabul edilmedi. Tekrar denemeden önce güncel kaydı kontrol edin." : "The action was not accepted. Check the current record before trying again.";
    default: return "";
  }
}
