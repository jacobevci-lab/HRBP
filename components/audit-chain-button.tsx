"use client";

import { BadgeCheck, LoaderCircle, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

export function AuditChainButton() {
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function verify() {
    setLoading(true); setResult(null);
    try {
      const response = await fetch("/api/audit/verify", { cache: "no-store", headers: { "x-purpose": "Audit ledger integrity verification" } });
      const value = await response.json() as { status?: string; verified?: number; total?: number; error?: string };
      if (!response.ok || value.status !== "ok") setResult({ ok: false, message: value.error || c("Ledger verification failed.","Denetim zinciri doğrulaması başarısız.") });
      else setResult({ ok: true, message: c(`${value.verified ?? 0} of ${value.total ?? 0} events verified.`,`${value.total ?? 0} olayın ${value.verified ?? 0} adedi doğrulandı.`) });
    } catch { setResult({ ok: false, message: c("Verification endpoint could not be reached.","Doğrulama servisine ulaşılamadı.") }); }
    finally { setLoading(false); }
  }

  return <div className="audit-verify-control"><button className="secondary-button" type="button" onClick={verify} disabled={loading}>{loading ? <LoaderCircle size={15}/> : <BadgeCheck size={15}/>} {loading ? c("Verifying…","Doğrulanıyor…") : c("Verify hash chain","Hash zincirini doğrula")}</button>{result ? <span className={result.ok ? "audit-verify-ok" : "audit-verify-error"}>{result.ok ? <BadgeCheck size={14}/> : <ShieldAlert size={14}/>} {result.message}</span> : null}</div>;
}
