"use client";

import { RefreshCw, ShieldX, UserRoundX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";

type Account = {
  id: string;
  subject: string;
  displayName: string;
  email: string | null;
  role: string;
  sessionVersion: number;
  sessionsRevokedAt: string | null;
};

type Payload = {
  tenant: { id: string; sessionVersion: number; sessionsRevokedAt: string | null };
  accounts: Account[];
  totalAccounts: number;
  truncated: boolean;
  query: string;
  currentActorId: string;
};

function fmt(locale: "en" | "tr", value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function SessionRevocationAdmin() {
  const { locale } = useLocale();
  const tr = locale === "tr";
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tenantConfirmation, setTenantConfirmation] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async (query = "") => {
    setLoading(true);
    setError(null);
    try {
      const target = query.trim()
        ? `/api/settings/session-revocation?q=${encodeURIComponent(query.trim())}`
        : "/api/settings/session-revocation";
      const response = await fetch(target, { cache: "no-store" });
      const body = await response.json() as { data?: Payload; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error || `HTTP ${response.status}`);
      setData(body.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (tr ? "Oturum durumu yüklenemedi." : "Session state could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => { void load(""); }, [load]);

  async function post(payload: Record<string, unknown>) {
    const response = await fetch("/api/settings/session-revocation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json() as { error?: string; currentSessionRevoked?: boolean };
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  async function revokeAccount(account: Account) {
    const label = account.displayName || account.subject;
    if (!window.confirm(tr
      ? `${label} için tüm aktif uygulama oturumları iptal edilsin mi?`
      : `Revoke all active application sessions for ${label}?`)) return;
    setBusy(account.id);
    setError(null);
    setSuccess(null);
    try {
      const result = await post({ action: "revoke-account", accountId: account.id });
      if (result.currentSessionRevoked) {
        window.location.assign("/auth/sign-in");
        return;
      }
      setSuccess(tr ? "Hesabın aktif oturumları iptal edildi." : "Active sessions for the account were revoked.");
      await load(search);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (tr ? "Oturumlar iptal edilemedi." : "Sessions could not be revoked."));
    } finally {
      setBusy(null);
    }
  }

  async function revokeTenant() {
    if (!data || tenantConfirmation !== data.tenant.id) return;
    if (!window.confirm(tr
      ? "Bu tenant içindeki TÜM kullanıcı oturumları iptal edilecek. Devam edilsin mi?"
      : "ALL user sessions in this tenant will be revoked. Continue?")) return;
    setBusy("tenant");
    setError(null);
    setSuccess(null);
    try {
      await post({ action: "revoke-tenant", confirmation: data.tenant.id });
      window.location.assign("/auth/sign-in");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (tr ? "Tenant oturumları iptal edilemedi." : "Tenant sessions could not be revoked."));
      setBusy(null);
    }
  }

  return <section className="card settings-live-panel session-revocation-admin">
    <div className="settings-live-panel-head">
      <div>
        <span className="section-kicker">{tr ? "Oturum güvenliği" : "Session security"}</span>
        <h3>{tr ? "Aktif oturumları iptal et" : "Revoke active sessions"}</h3>
        <p>{tr
          ? "Çalınmış/kopyalanmış cookie'leri ve mevcut uygulama oturumlarını bir sonraki istekte geçersiz kılar."
          : "Invalidates copied/stolen cookies and existing application sessions on their next request."}</p>
      </div>
      <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
        <RefreshCw size={14}/>{tr ? "Yenile" : "Refresh"}
      </button>
    </div>

    {error ? <div className="workflow-action-message error">{error}</div> : null}
    {success ? <div className="workflow-action-message success">{success}</div> : null}

    <div className="settings-live-checks">
      <div>
        <ShieldX size={17}/>
        <span>
          <strong>{tr ? "Tenant geneli" : "Tenant-wide"}</strong>
          <small>{tr
            ? `Son toplu iptal: ${fmt(locale, data?.tenant.sessionsRevokedAt ?? null)}`
            : `Last tenant-wide revocation: ${fmt(locale, data?.tenant.sessionsRevokedAt ?? null)}`}</small>
        </span>
        <div className="local-account-reset">
          <input
            value={tenantConfirmation}
            onChange={(event) => setTenantConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={data?.tenant.id ?? (tr ? "Tenant kimliği" : "Tenant id")}
            aria-label={tr ? "Tenant kimliğini yazarak doğrula" : "Confirm by typing tenant id"}
          />
          <button className="secondary-button compact" type="button" disabled={!data || busy === "tenant" || tenantConfirmation !== data.tenant.id} onClick={() => void revokeTenant()}>
            <ShieldX size={13}/>{tr ? "Tümünü iptal et" : "Revoke all"}
          </button>
        </div>
      </div>
    </div>

    <form className="local-account-create" onSubmit={(event) => { event.preventDefault(); void load(search); }}>
      <label>
        <span>{tr ? "Hesap ara" : "Search accounts"}</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          maxLength={160}
          placeholder={tr ? "Ad, e-posta veya subject" : "Name, email or subject"}
        />
      </label>
      <button className="secondary-button compact" type="submit" disabled={loading}>
        <RefreshCw size={13}/>{tr ? "Ara" : "Search"}
      </button>
      {data?.query ? <button className="secondary-button compact" type="button" onClick={() => { setSearch(""); void load(""); }}>{tr ? "Temizle" : "Clear"}</button> : null}
    </form>

    <div className="settings-live-table-wrap">
      <table className="settings-live-table">
        <thead><tr><th>{tr ? "Hesap" : "Account"}</th><th>{tr ? "Rol" : "Role"}</th><th>{tr ? "Son iptal" : "Last revocation"}</th><th>{tr ? "İşlem" : "Action"}</th></tr></thead>
        <tbody>
          {(data?.accounts ?? []).map((account) => <tr key={account.id}>
            <td><strong>{account.displayName}</strong><small>{account.email || account.subject}{account.id === data?.currentActorId ? (tr ? " · mevcut oturum" : " · current session") : ""}</small></td>
            <td>{account.role.replaceAll("_", " ")}</td>
            <td>{fmt(locale, account.sessionsRevokedAt)}</td>
            <td><button className="secondary-button compact" type="button" disabled={busy === account.id} onClick={() => void revokeAccount(account)}><UserRoundX size={13}/>{tr ? "Oturumları iptal et" : "Revoke sessions"}</button></td>
          </tr>)}
          {!loading && !data?.accounts.length ? <tr><td className="settings-live-empty" colSpan={4}>{tr ? "Aktif hesap bulunamadı." : "No active accounts found."}</td></tr> : null}
          {loading && !data ? <tr><td className="settings-live-empty" colSpan={4}>{tr ? "Yükleniyor…" : "Loading…"}</td></tr> : null}
        </tbody>
      </table>
    </div>
    {data?.truncated ? <p className="settings-live-footnote">{tr ? `İlk ${data.accounts.length} / ${data.totalAccounts} eşleşen aktif hesap gösteriliyor; aramayı daraltın.` : `Showing the first ${data.accounts.length} of ${data.totalAccounts} matching active accounts; refine the search.`}</p> : null}
  </section>;
}
