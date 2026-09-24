"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

export function NotificationDeadLetterAction({ count }: { count: number }) {
  const { locale } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function retry() {
    if (count <= 0 || busy) return;
    const confirmed = window.confirm(locale === "tr"
      ? `${Math.min(count, 100)} dead-letter bildirimi yeniden kuyruğa alınsın mı?`
      : `Requeue up to ${Math.min(count, 100)} dead-letter notifications?`);
    if (!confirmed) return;

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/notifications/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 100 })
      });
      const body = await response.json() as { data?: { requeued?: number }; error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      const requeued = body.data?.requeued ?? 0;
      setMessage(locale === "tr" ? `${requeued} bildirim yeniden kuyruğa alındı.` : `${requeued} notifications were requeued.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (locale === "tr" ? "Yeniden kuyruğa alma başarısız." : "Requeue failed."));
    } finally {
      setBusy(false);
    }
  }

  return <div className="settings-notification-action">
    <button className="secondary-button" type="button" disabled={count <= 0 || busy} onClick={() => void retry()}>
      <RotateCcw size={14}/>{busy ? (locale === "tr" ? "İşleniyor…" : "Processing…") : (locale === "tr" ? "Dead-letter yeniden dene" : "Retry dead letters")}
    </button>
    {message ? <small>{message}</small> : null}
  </div>;
}
