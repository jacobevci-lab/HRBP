"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "pending" | "saved" | "unknown" | "conflict" | "denied" | "missing" | "rejected" | "limited";
type Attempt = { key: string; pending: boolean; phase: Phase; action: string };
type Options = { action: string; confirmation: string; url: string; init: RequestInit; expectedStatus: number; events: readonly string[]; accepts: (data: unknown) => boolean };
const MAX_RECORD_OUTCOMES = 32;

/** Mounted-instance click/receipt safety only, not durable server idempotency.
 * Retain each attempted record's result even while another record is visible.
 * Never evict uncertain/saved outcomes to make room: require a read-only reload.
 * Stores bounded record keys and outcome labels, never request/response bodies.
 */
export function usePolicyAction(recordKey: string) {
  const router = useRouter();
  const mounted = useRef(true), latestKey = useRef(recordKey);
  const active = useRef<Attempt | null>(null);
  const outcomes = useRef(new Map<string, Attempt>());
  const [, invalidate] = useState(0);
  latestKey.current = recordKey;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function run(options: Options) {
    if (!mounted.current || latestKey.current !== recordKey || active.current?.pending ||
        outcomes.current.has(recordKey) || outcomes.current.size >= MAX_RECORD_OUTCOMES) return;
    // Acquire synchronously, before confirmation or the first awaited call.
    const attempt: Attempt = { key: recordKey, pending: true, phase: "pending", action: options.action };
    active.current = attempt;
    let confirmed = false;
    try { confirmed = window.confirm(options.confirmation); } catch { /* Nothing was sent. */ }
    if (!confirmed || !mounted.current || latestKey.current !== recordKey) {
      if (active.current === attempt) active.current = null;
      if (mounted.current) invalidate(value => value + 1);
      return;
    }
    // Only confirmed, dispatchable operations consume a history slot.
    outcomes.current.set(recordKey, attempt);
    invalidate(value => value + 1);
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
      // Unknown responses never imply rollback or authorize an automatic retry.
    } catch { phase = "unknown"; }
    attempt.pending = false;
    attempt.phase = phase;
    if (active.current === attempt) active.current = null;
    if (!mounted.current) return;
    // A late result stays attached to its original key. It may release the
    // busy state of B, but must never refresh B or discard A's replay guard.
    invalidate(value => value + 1);
    if (latestKey.current !== recordKey) return;
    if (phase === "saved") {
      for (const name of options.events) {
        try { window.dispatchEvent(new Event(name)); } catch { /* Reload remains available. */ }
      }
      try { router.refresh(); } catch { /* A confirmed commit remains saved. */ }
    }
  }
  const outcome = outcomes.current.get(recordKey);
  const limited = !outcome && outcomes.current.size >= MAX_RECORD_OUTCOMES;
  return {
    phase: outcome?.phase ?? (limited ? "limited" as const : "idle" as const),
    action: outcome?.action ?? "", run,
    blocked: Boolean(active.current?.pending || outcome || limited),
    reload: () => window.location.reload()
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function policyActionMessage(phase: Phase, locale: string) {
  const tr = locale === "tr";
  switch (phase) {
    case "limited": return tr ? "Bu görünümde çok sayıda kayıt işlendi. Yeni bir işlemden önce güncel kayıtları yeniden yükleyin." : "Many records have been processed in this view. Reload current records before another action.";
    case "saved": return tr ? "İşlem kaydedildi. Yeni bir işlemden önce güncel kaydı kontrol edin." : "The action was saved. Check the current record before another change.";
    case "unknown": return tr ? "İşlem sonucu doğrulanamadı. Tekrar göndermeden önce güncel kaydı yeniden yükleyip kontrol edin." : "The result could not be confirmed. Reload and check the current record before submitting again.";
    case "conflict": return tr ? "Politikanın durumu değişmiş veya bu işlem artık uygun değil. Güncel kaydı yeniden yükleyin." : "The policy state changed or this action is no longer allowed. Reload the current record.";
    case "denied": return tr ? "Oturumunuz veya yetkiniz bu işleme izin vermiyor. Erişiminizi yeniden doğrulayın." : "Your session or permissions do not allow this action. Verify your access again.";
    case "missing": return tr ? "Politika veya ilgili kayıt bu kapsamda bulunamadı. Güncel kayıtları yeniden yükleyin." : "The policy or related record was not found in this scope. Reload the current records.";
    case "rejected": return tr ? "İşlem kabul edilmedi. Tekrar denemeden önce güncel kaydı kontrol edin." : "The action was not accepted. Check the current record before trying again.";
    default: return "";
  }
}
