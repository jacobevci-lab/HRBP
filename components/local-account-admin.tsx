"use client";

import { KeyRound, LockKeyhole, Plus, RefreshCw, RotateCcw, ShieldCheck, UnlockKeyhole, UserRoundPlus } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";

type LocalAccount = {
  id: string;
  subject: string;
  displayName: string;
  email: string | null;
  role: string;
  active: boolean;
  localAuthEnabled: boolean;
  localPasswordUpdatedAt: string | null;
  localFailedAttempts: number;
  localLockedUntil: string | null;
  lastLocalLoginAt: string | null;
};

const roles = [
  "EMPLOYEE", "MANAGER", "HRBP", "HR_OPERATIONS", "RECRUITER", "TIME_ADMIN",
  "TALENT_ADMIN", "COMPENSATION_ADMIN", "PAYROLL_ADMIN", "ER_INVESTIGATOR",
  "LEGAL", "PRIVACY_OFFICER", "SECURITY_AUDITOR", "TENANT_ADMIN"
] as const;

function fmt(locale: "en" | "tr", value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function LocalAccountAdmin() {
  const { locale } = useLocale();
  const tr = locale === "tr";
  const [items, setItems] = useState<LocalAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/local-accounts", { cache: "no-store" });
      const body = await response.json() as { data?: LocalAccount[]; error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setItems(body.data ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (tr ? "Yerel hesaplar yüklenemedi." : "Local accounts could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => { void load(); }, [load]);

  async function mutate(id: string, payload: Record<string, unknown>, successMessage: string) {
    setBusy(id);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/settings/local-accounts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setSuccess(successMessage);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (tr ? "İşlem tamamlanamadı." : "Operation could not be completed."));
    } finally {
      setBusy(null);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      subject: form.get("subject"),
      displayName: form.get("displayName"),
      email: form.get("email"),
      role: form.get("role"),
      password: form.get("password")
    };
    setBusy("create");
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/settings/local-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      event.currentTarget.reset();
      setSuccess(tr ? "Yerel hesap oluşturuldu." : "Local account created.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (tr ? "Yerel hesap oluşturulamadı." : "Local account could not be created."));
    } finally {
      setBusy(null);
    }
  }

  async function submitReset(id: string) {
    if (resetPassword.length < 12) {
      setError(tr ? "Parola en az 12 karakter olmalı." : "Password must be at least 12 characters.");
      return;
    }
    await mutate(id, { action: "reset-password", password: resetPassword }, tr ? "Parola yenilendi." : "Password reset.");
    setResetId(null);
    setResetPassword("");
  }

  return <section className="card settings-live-panel local-account-admin">
    <div className="settings-live-panel-head">
      <div>
        <span className="section-kicker">{tr ? "Yerel kimlik doğrulama" : "Local authentication"}</span>
        <h3>{tr ? "Yerel hesap yönetimi" : "Local account administration"}</h3>
        <p>{tr ? "Acil durum, test ve SSO dışı kontrollü erişim için tenant kapsamlı yerel hesapları yönetin. Parolalar hiçbir zaman arayüze geri döndürülmez." : "Manage tenant-scoped local accounts for break-glass, testing and controlled non-SSO access. Passwords are never returned to the UI."}</p>
      </div>
      <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={14}/>{tr ? "Yenile" : "Refresh"}</button>
    </div>

    {error ? <div className="workflow-action-message error">{error}</div> : null}
    {success ? <div className="workflow-action-message success">{success}</div> : null}

    <form className="local-account-create" onSubmit={create}>
      <label><span>{tr ? "Kullanıcı adı" : "Subject"}</span><input name="subject" required minLength={3} maxLength={191} placeholder="local.admin"/></label>
      <label><span>{tr ? "Görünen ad" : "Display name"}</span><input name="displayName" required maxLength={160}/></label>
      <label><span>E-mail</span><input name="email" type="email" maxLength={254}/></label>
      <label><span>{tr ? "Rol" : "Role"}</span><select name="role" defaultValue="EMPLOYEE">{roles.map((role) => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}</select></label>
      <label><span>{tr ? "İlk parola" : "Initial password"}</span><input name="password" type="password" required minLength={12} maxLength={256} autoComplete="new-password"/></label>
      <button className="primary-button compact" type="submit" disabled={busy === "create"}><UserRoundPlus size={14}/>{busy === "create" ? (tr ? "Oluşturuluyor…" : "Creating…") : (tr ? "Hesap oluştur" : "Create account")}</button>
    </form>

    <div className="settings-live-table-wrap">
      <table className="settings-live-table local-account-table">
        <thead><tr><th>{tr ? "Hesap" : "Account"}</th><th>{tr ? "Rol" : "Role"}</th><th>{tr ? "Giriş" : "Sign-in"}</th><th>{tr ? "Son giriş" : "Last sign-in"}</th><th>{tr ? "Kilit" : "Lock"}</th><th>{tr ? "İşlemler" : "Operations"}</th></tr></thead>
        <tbody>
          {items.map((item) => {
            const locked = Boolean(item.localLockedUntil && new Date(item.localLockedUntil).getTime() > Date.now());
            return <tr key={item.id}>
              <td><strong>{item.displayName}</strong><small>{item.subject}{item.email ? ` · ${item.email}` : ""}</small></td>
              <td>{item.role.replaceAll("_", " ")}</td>
              <td><span className={item.localAuthEnabled ? "settings-live-state ok" : "settings-live-state attention"}>{item.localAuthEnabled ? (tr ? "Etkin" : "Enabled") : (tr ? "Kapalı" : "Disabled")}</span></td>
              <td>{fmt(locale, item.lastLocalLoginAt)}</td>
              <td>{locked ? <span className="settings-live-state attention">{tr ? "Kilitli" : "Locked"}</span> : <span className="settings-live-state ok">{tr ? "Açık" : "Clear"}</span>}</td>
              <td>
                <div className="local-account-actions">
                  {item.localAuthEnabled
                    ? <button type="button" className="secondary-button compact" disabled={busy === item.id} onClick={() => void mutate(item.id, { action: "disable" }, tr ? "Yerel giriş kapatıldı." : "Local sign-in disabled.")}><LockKeyhole size={13}/>{tr ? "Kapat" : "Disable"}</button>
                    : <button type="button" className="secondary-button compact" disabled={busy === item.id} onClick={() => void mutate(item.id, { action: "enable" }, tr ? "Yerel giriş etkinleştirildi." : "Local sign-in enabled.")}><ShieldCheck size={13}/>{tr ? "Etkinleştir" : "Enable"}</button>}
                  {locked ? <button type="button" className="secondary-button compact" disabled={busy === item.id} onClick={() => void mutate(item.id, { action: "unlock" }, tr ? "Hesap kilidi açıldı." : "Account unlocked.")}><UnlockKeyhole size={13}/>{tr ? "Kilidi aç" : "Unlock"}</button> : null}
                  <button type="button" className="secondary-button compact" onClick={() => { setResetId(resetId === item.id ? null : item.id); setResetPassword(""); }}><RotateCcw size={13}/>{tr ? "Parola" : "Password"}</button>
                </div>
                {resetId === item.id ? <div className="local-account-reset"><input type="password" value={resetPassword} minLength={12} maxLength={256} autoComplete="new-password" onChange={(event) => setResetPassword(event.target.value)} placeholder={tr ? "Yeni parola (12+)" : "New password (12+)"}/><button type="button" className="primary-button compact" disabled={busy === item.id} onClick={() => void submitReset(item.id)}><KeyRound size={13}/>{tr ? "Kaydet" : "Save"}</button></div> : null}
              </td>
            </tr>;
          })}
          {!items.length && !loading ? <tr><td colSpan={6} className="settings-live-empty">{tr ? "Bu tenant için yerel hesap bulunmuyor." : "No local accounts exist for this tenant."}</td></tr> : null}
          {loading && !items.length ? <tr><td colSpan={6} className="settings-live-empty">{tr ? "Yerel hesaplar yükleniyor…" : "Loading local accounts…"}</td></tr> : null}
        </tbody>
      </table>
    </div>
  </section>;
}
