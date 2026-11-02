"use client";

import { Archive, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

export function JobProfileLifecycleActions({ id, status }: { id: string; status: "DRAFT" | "ACTIVE" | "RETIRED" }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "RETIRED") return <span>—</span>;
  const action = status === "DRAFT" ? "ACTIVATE" : "RETIRE";
  const label = action === "ACTIVATE" ? c("Activate", "Aktifleştir") : c("Retire", "Emekliye ayır");

  async function run() {
    if (busy) return;
    if (action === "RETIRE" && !window.confirm(c(
      "Retire this profile now? Existing positions keep their historical reference, but new positions can no longer select it.",
      "Bu profili şimdi emekliye ayırmak istiyor musunuz? Mevcut pozisyonlar tarihsel referansı korur ancak yeni pozisyonlar artık bu profili seçemez."
    ))) return;

    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/job-architecture/profiles/${encodeURIComponent(id)}/lifecycle`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-purpose": "Job profile lifecycle administration" },
        body: JSON.stringify({ action })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? c("Job profile lifecycle action failed.", "İş profili yaşam döngüsü işlemi başarısız oldu."));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c("Job profile lifecycle action failed.", "İş profili yaşam döngüsü işlemi başarısız oldu."));
    } finally { setBusy(false); }
  }

  return <div style={{ display: "grid", gap: 4, justifyItems: "start" }}>
    <button type="button" className={action === "ACTIVATE" ? "create-button" : "secondary-button"} onClick={run} disabled={busy}>
      {action === "ACTIVATE" ? <CheckCircle2 size={14}/> : <Archive size={14}/>}
      {busy ? c("Saving…", "Kaydediliyor…") : label}
    </button>
    {error ? <small className="form-error" aria-live="polite">{error}</small> : null}
  </div>;
}
