"use client";

import { MailCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { useSessionContext } from "@/components/session-provider";

type Phase = "pending" | "accepted" | "audit-warning" | "unknown" | "denied" | "limited" | "unavailable";
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));

export function SmtpTestAction({ enabled }: { enabled: boolean }) {
  const { locale } = useLocale(), { session, loading } = useSessionContext();
  const user = session?.user, tr = locale === "tr";
  const allowed = Boolean(enabled && !loading && session?.authenticated && user?.role === "TENANT_ADMIN");
  const key = JSON.stringify([user?.tenantId, user?.id, user?.role]);
  const latest = useRef({ key, allowed }); latest.current = { key, allowed };
  const mounted = useRef(true), pending = useRef(false), outcomes = useRef(new Map<string, Phase>());
  const [, redraw] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && latest.current.allowed && latest.current.key === key;
  const render = () => { if (mounted.current) redraw(n => n + 1); };
  const phase = outcomes.current.get(key), full = !phase && outcomes.current.size >= 32;

  async function sendTest() {
    if (!user || !current() || pending.current || outcomes.current.has(key) || full) return;
    pending.current = true;
    let testId: string;
    try {
      if (!window.confirm(tr ? "Yalnız kendi hesabınıza bir test e-postası gönderilsin mi? Gelen kutusuna teslim ayrıca kontrol edilmelidir." : "Send one test email to your own account? Mailbox delivery must be checked separately.") || !current()) {
        pending.current = false; render(); return;
      }
      testId = crypto.randomUUID();
    } catch { pending.current = false; render(); return; }
    outcomes.current.set(key, "pending"); render();
    let result: Phase = "unknown";
    try {
      const response = await fetch("/api/settings/notifications/smtp-test", {
        method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
        signal: AbortSignal.timeout(70_000), headers: { accept: "application/json", "x-hrbp-test-id": testId }
      });
      if ([200, 202].includes(response.status) && !response.redirected) {
        const body: unknown = await response.json(), data = object(body) ? body.data : null;
        if (object(data) && data.testId === testId && data.actorId === user.id && data.tenantId === user.tenantId &&
            data.sent === true && data.deliveryStatus === "SMTP_ACCEPTED" && data.mailboxDeliveryConfirmed === false &&
            data.auditRecorded === (response.status === 200)) result = data.auditRecorded ? "accepted" : "audit-warning";
      } else if ([401, 403].includes(response.status)) result = "denied";
      else if (response.status === 429) result = "limited";
      else if ([400, 409, 503].includes(response.status)) result = "unavailable";
    } catch { /* Unknown side effect: no automatic resend and no raw diagnostics. */ }
    outcomes.current.set(key, result); pending.current = false; render();
  }
  if (!allowed) return null;
  const message = phase === "accepted"
    ? (tr ? "SMTP sunucusu test e-postasını kabul etti. Gelen kutusu ve spam klasörünüzü ayrıca kontrol edin; teslim doğrulanmadı." : "The SMTP server accepted the test email. Check your inbox and spam folder separately; mailbox delivery is not verified.")
    : phase === "audit-warning"
    ? (tr ? "SMTP sunucusu kabul etti ancak sonuç denetim kaydı yazılamadı. Yeniden göndermeyin; denetim durumunu kontrol edin." : "SMTP accepted the email, but its outcome audit could not be recorded. Do not resend; investigate the audit state.")
    : phase === "unknown"
    ? (tr ? "Gönderim sonucu doğrulanamadı; e-posta kabul edilmiş olabilir. Yeniden göndermeden önce gelen kutusu ve sağlayıcı kayıtlarını kontrol edin." : "The send result is unknown; the email may have been accepted. Check your mailbox and provider records before another test.")
    : phase === "denied"
    ? (tr ? "Oturum veya yetki bu teste izin vermiyor. Erişiminizi yeniden doğrulayın." : "Your session or permissions do not allow this test. Verify your access again.")
    : phase === "limited"
    ? (tr ? "Bu hesap için yakın zamanda test istendi. En az 60 saniye bekleyin; otomatik tekrar yapılmayacak." : "A test was recently requested for this account. Wait at least 60 seconds; no automatic retry will occur.")
    : phase === "unavailable"
    ? (tr ? "Test başlatılamadı. Hesap, SMTP yapılandırması ve denetim sağlığını kontrol edin." : "The test could not be started. Check account, SMTP configuration and audit health.")
    : full ? (tr ? "Yeni testten önce ayarları yeniden yükleyin." : "Reload settings before a new test.") : "";

  return <div className="settings-smtp-test" data-smtp-verification>
    <button type="button" className="secondary-button compact" disabled={pending.current || Boolean(phase) || full} onClick={() => void sendTest()}>
      <MailCheck size={14}/>{phase === "pending" ? (tr ? "Gönderiliyor…" : "Sending…") : (tr ? "Test e-postası gönder" : "Send test email")}
    </button>
    {message ? <span role={phase === "accepted" ? "status" : "alert"} className={`workflow-action-message ${phase === "accepted" ? "success" : "error"}`}>{message}</span> : null}
    {phase && phase !== "pending" || full ? <button type="button" className="secondary-button compact" onClick={() => {
      if (current() && window.confirm(tr ? "Ayarlar yeniden yüklensin mi? Bu işlem e-posta göndermez." : "Reload settings? This does not send an email.")) window.location.reload();
    }}>{tr ? "Ayarları yeniden yükle" : "Reload settings"}</button> : null}
  </div>;
}
