"use client";

import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

export function PolicyAcknowledgementButton({ policyId }: { policyId: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;

  async function acknowledge() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/policies/${encodeURIComponent(policyId)}/acknowledgements`, {
        method: "POST",
        headers: { "x-purpose": "Policy acknowledgement" }
      });
      const value = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(value.error || c("Policy acknowledgement failed.", "Politika okuma/onay işlemi başarısız."));
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c("Policy service could not be reached.", "Politika servisine ulaşılamadı."));
    } finally {
      setBusy(false);
    }
  }

  return <div style={{ display: "grid", gap: 5 }}>
    <button type="button" className="mini-action approve" disabled={busy} onClick={() => void acknowledge()}>
      {busy ? <LoaderCircle size={13}/> : <CheckCircle2 size={13}/>} {c("Acknowledge policy", "Politikayı okudum/onayla")}
    </button>
    {error ? <small className="comp-decision-error">{error}</small> : null}
  </div>;
}
