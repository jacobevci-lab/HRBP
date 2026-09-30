"use client";

import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

export function PolicyAcknowledgementAction({ policyId, status }: { policyId: string; status: string | null }) {
  const router = useRouter();
  const { locale } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;

  if (status === "Acknowledged" || status === "Waived") {
    return <span className="matrix-note"><CheckCircle2 size={12}/> {c("Acknowledged", "Onaylandı")}</span>;
  }

  async function acknowledge() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/policies/${encodeURIComponent(policyId)}/acknowledgements`, {
        method: "POST",
        headers: { "x-purpose": "Policy acknowledgement" }
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || c("Policy acknowledgement failed.", "Politika onayı başarısız oldu."));
        return;
      }
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      window.dispatchEvent(new Event("hrbp:notifications-changed"));
      router.refresh();
    } catch {
      setError(c("The policy service could not be reached.", "Politika servisine ulaşılamadı."));
    } finally {
      setBusy(false);
    }
  }

  return <div className="comp-decision-wrap">
    <button type="button" className="mini-action approve" disabled={busy} onClick={() => void acknowledge()}>
      {busy ? <LoaderCircle size={13}/> : <CheckCircle2 size={13}/>} {c("Acknowledge", "Okudum / Onayla")}
    </button>
    {error ? <small className="comp-decision-error">{error}</small> : null}
  </div>;
}
