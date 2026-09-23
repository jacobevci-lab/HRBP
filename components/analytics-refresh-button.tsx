"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/locale-provider";

export function AnalyticsRefreshButton() {
  const router = useRouter();
  const { locale } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/analytics/materialize", { method: "POST" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c("Governed metrics could not be refreshed.", "Yönetişimli metrikler yenilenemedi."));
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c("Governed metrics could not be refreshed.", "Yönetişimli metrikler yenilenemedi."));
    } finally {
      setBusy(false);
    }
  }

  return <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
    <button className="secondary-button" type="button" onClick={refresh} disabled={busy}>
      <RefreshCw size={16} className={busy ? "spin" : undefined}/>
      {busy ? c("Refreshing…", "Yenileniyor…") : c("Refresh governed metrics", "Yönetişimli metrikleri yenile")}
    </button>
    {error ? <small style={{ color: "var(--red)", maxWidth: 280, textAlign: "right" }}>{error}</small> : null}
  </div>;
}
