"use client";

import { KeyRound, Link2, Plus, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

type Notice = { kind: "ok" | "error"; text: string } | null;

const identityTypes = ["ENTRA_ID", "OKTA", "OIDC", "SAML", "LDAP", "LOCAL"] as const;

function splitScopes(value: string) {
  return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean).slice(0, 100);
}

export function SettingsConnectionsManager() {
  const { locale } = useLocale();
  const router = useRouter();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const [identityBusy, setIdentityBusy] = useState(false);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [identityNotice, setIdentityNotice] = useState<Notice>(null);
  const [integrationNotice, setIntegrationNotice] = useState<Notice>(null);

  async function createIdentity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (identityBusy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setIdentityBusy(true);
    setIdentityNotice(null);
    try {
      const response = await fetch("/api/settings/identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          type: form.get("type"),
          issuer: form.get("issuer"),
          metadataUrl: form.get("metadataUrl"),
          clientId: form.get("clientId"),
          directoryTenantId: form.get("directoryTenantId"),
          secretRef: form.get("secretRef"),
          scimEnabled: form.get("scimEnabled") === "on",
          jitEnabled: form.get("jitEnabled") === "on",
          mfaRequired: form.get("mfaRequired") === "on"
        })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      formElement.reset();
      setIdentityNotice({ kind: "ok", text: c("Identity provider registered as DRAFT and audited.", "Kimlik sağlayıcı DRAFT olarak kaydedildi ve denetim kaydına işlendi.") });
      router.refresh();
    } catch (error) {
      setIdentityNotice({ kind: "error", text: error instanceof Error ? error.message : c("Identity provider could not be created.", "Kimlik sağlayıcı oluşturulamadı.") });
    } finally {
      setIdentityBusy(false);
    }
  }

  async function createIntegration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (integrationBusy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setIntegrationBusy(true);
    setIntegrationNotice(null);
    try {
      const response = await fetch("/api/settings/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          systemType: form.get("systemType"),
          baseUrl: form.get("baseUrl"),
          authType: form.get("authType"),
          secretRef: form.get("secretRef"),
          scopes: splitScopes(String(form.get("scopes") ?? "")),
          enabled: form.get("enabled") === "on"
        })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      formElement.reset();
      setIntegrationNotice({ kind: "ok", text: c("Integration registered as DRAFT and audited.", "Entegrasyon DRAFT olarak kaydedildi ve denetim kaydına işlendi.") });
      router.refresh();
    } catch (error) {
      setIntegrationNotice({ kind: "error", text: error instanceof Error ? error.message : c("Integration could not be created.", "Entegrasyon oluşturulamadı.") });
    } finally {
      setIntegrationBusy(false);
    }
  }

  return <section className="settings-connections-manager">
    <div className="settings-connections-heading"><div><span className="section-kicker">{c("Governed connections", "Yönetişim kontrollü bağlantılar")}</span><h2>{c("Identity & Integration Registration", "Kimlik & Entegrasyon Kaydı")}</h2><p>{c("Create metadata records only. Secret values stay in your external vault; HRBP stores references.", "Yalnızca metadata kaydı oluşturun. Secret değerleri harici vault içinde kalır; HRBP yalnızca referans saklar.")}</p></div><ShieldCheck size={20}/></div>
    <div className="settings-connections-grid">
      <form className="card settings-connection-form" onSubmit={createIdentity}>
        <div className="settings-connection-title"><KeyRound size={18}/><div><strong>{c("Identity provider", "Kimlik sağlayıcı")}</strong><small>{c("Entra ID, Okta, OIDC, SAML, LDAP or local identity metadata.", "Entra ID, Okta, OIDC, SAML, LDAP veya lokal kimlik metadata kaydı.")}</small></div></div>
        <div className="settings-connection-fields">
          <label>{c("Name", "Ad")}<input name="name" maxLength={120} required placeholder="Corporate Entra ID"/></label>
          <label>{c("Type", "Tür")}<select name="type" defaultValue="ENTRA_ID">{identityTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
          <label className="wide">{c("Issuer / LDAP endpoint", "Issuer / LDAP endpoint")}<input name="issuer" maxLength={1024} placeholder="https://login.microsoftonline.com/.../v2.0 or ldaps://ldap.example.com"/></label>
          <label className="wide">SAML metadata URL<input name="metadataUrl" type="url" maxLength={1024} placeholder="https://idp.example.com/metadata.xml"/></label>
          <label>Client ID<input name="clientId" maxLength={256}/></label>
          <label>{c("Directory tenant ID", "Directory tenant ID")}<input name="directoryTenantId" maxLength={191}/></label>
          <label className="wide">Secret reference<input name="secretRef" maxLength={512} placeholder="vault://identity/entra-client-secret"/></label>
        </div>
        <div className="settings-connection-flags">
          <label><input name="scimEnabled" type="checkbox"/><span>SCIM</span></label>
          <label><input name="jitEnabled" type="checkbox"/><span>JIT</span></label>
          <label><input name="mfaRequired" type="checkbox" defaultChecked/><span>{c("MFA required", "MFA zorunlu")}</span></label>
        </div>
        {identityNotice ? <div className={`settings-policy-message ${identityNotice.kind}`}>{identityNotice.text}</div> : null}
        <button className="create-button" type="submit" disabled={identityBusy}><Plus size={15}/>{identityBusy ? c("Creating…", "Oluşturuluyor…") : c("Register identity provider", "Kimlik sağlayıcı kaydet")}</button>
      </form>

      <form className="card settings-connection-form" onSubmit={createIntegration}>
        <div className="settings-connection-title"><Link2 size={18}/><div><strong>{c("System integration", "Sistem entegrasyonu")}</strong><small>{c("Register an HR, ITSM, payroll, directory or analytics connection.", "İK, ITSM, bordro, directory veya analitik bağlantısını kaydedin.")}</small></div></div>
        <div className="settings-connection-fields">
          <label>{c("Name", "Ad")}<input name="name" maxLength={120} required placeholder="Corporate Jira"/></label>
          <label>{c("System type", "Sistem türü")}<input name="systemType" maxLength={120} required placeholder="JIRA"/></label>
          <label className="wide">Base URL<input name="baseUrl" type="url" maxLength={1024} placeholder="https://company.atlassian.net"/></label>
          <label>{c("Authentication type", "Kimlik doğrulama türü")}<input name="authType" maxLength={80} required placeholder="OAUTH2"/></label>
          <label>Secret reference<input name="secretRef" maxLength={512} placeholder="vault://integrations/jira"/></label>
          <label className="wide">{c("Scopes (comma or space separated)", "Scope'lar (virgül veya boşlukla ayrılmış)")}<input name="scopes" maxLength={4000} placeholder="read:jira-work, read:jira-user"/></label>
        </div>
        <div className="settings-connection-flags"><label><input name="enabled" type="checkbox"/><span>{c("Enable after registration", "Kayıttan sonra etkinleştir")}</span></label></div>
        {integrationNotice ? <div className={`settings-policy-message ${integrationNotice.kind}`}>{integrationNotice.text}</div> : null}
        <button className="create-button" type="submit" disabled={integrationBusy}><Plus size={15}/>{integrationBusy ? c("Creating…", "Oluşturuluyor…") : c("Register integration", "Entegrasyon kaydet")}</button>
      </form>
    </div>
  </section>;
}
