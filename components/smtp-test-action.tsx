"use client";

import { MailCheck } from "lucide-react";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

export function SmtpTestAction({ enabled }: { enabled: boolean }) {
  const { locale } = useLocale();
  const tr = locale === "tr";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  if (!enabled) return null;

  async function sendTest() {
    setBusy(true);
    setMessage(null);
    setError(false);
    try {
      const response = await fetch("/api/settings/notifications/smtp-test", {
        method: "POST",
        headers: { accept: "application/json" }
      });
      const body = await response.json() as {
        data?: { sent?: boolean; recipient?: string };
        error?: string;
      };
      if (!response.ok || !body.data?.sent) throw new Error(body.error || ("HTTP " + response.status));
      setMessage(tr
        ? "Test e-postası gönderildi: " + (body.data.recipient ?? "hesabınız")
        : "Test email sent: " + (body.data.recipient ?? "your account"));
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error
        ? cause.message
        : (tr ? "SMTP test teslimatı başarısız." : "SMTP test delivery failed."));
    } finally {
      setBusy(false);
    }
  }

  return <div className="settings-smtp-test">
    <button type="button" className="secondary-button compact" disabled={busy} onClick={() => void sendTest()}>
      <MailCheck size={14}/>
      {busy ? (tr ? "Gönderiliyor…" : "Sending…") : (tr ? "Test e-postası gönder" : "Send test email")}
    </button>
    {message ? <span className={error ? "workflow-action-message error" : "workflow-action-message success"}>{message}</span> : null}
  </div>;
}
