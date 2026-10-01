"use client";

import { KeyRound, Link2, RefreshCw, Save } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";

type Identity = {
  id: string;
  name: string;
  type: string;
  issuer: string | null;
  clientId: string | null;
  metadataUrl: string | null;
  directoryTenantId: string | null;
  secretRef: string | null;
  scimEnabled: boolean;
  jitEnabled: boolean;
  mfaRequired: boolean;
  status: string;
  updatedAt: string;
};

type Integration = {
  id: string;
  name: string;
  systemType: string;
  baseUrl: string | null;
  authType: string;
  secretRef: string | null;
  scopes: unknown;
  status: string;
  enabled: boolean;
  updatedAt: string;
};

const identityTypes = ["ENTRA_ID","OKTA","OIDC","SAML","LDAP","LOCAL"] as const;

function scopeText(value: unknown) {
  if (!Array.isArray(value)) return "";
  return value.filter((item): item is string => typeof item === "string").join(", ");
}

function splitScopes(value: string) {
  return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean).slice(0, 100);
}

export function ConnectionMetadataEditor() {
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;

  const [identities, setIdentities] = useState<Identity[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [identityId, setIdentityId] = useState("");
  const [integrationId, setIntegrationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"identity" | "integration" | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const draftIdentities = useMemo(() => identities.filter((item) => item.status === "DRAFT"), [identities]);
  const draftIntegrations = useMemo(() => integrations.filter((item) => item.status === "DRAFT"), [integrations]);
  const identity = useMemo(() => draftIdentities.find((item) => item.id === identityId) ?? null, [draftIdentities, identityId]);
  const integration = useMemo(() => draftIntegrations.find((item) => item.id === integrationId) ?? null, [draftIntegrations, integrationId]);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const [identityResponse, integrationResponse] = await Promise.all([
        fetch("/api/settings/identity", { cache: "no-store" }),
        fetch("/api/settings/integrations", { cache: "no-store" })
      ]);
      const identityBody = await identityResponse.json() as { data?: Identity[]; error?: string };
      const integrationBody = await integrationResponse.json() as { data?: Integration[]; error?: string };
      if (!identityResponse.ok) throw new Error(identityBody.error || `HTTP ${identityResponse.status}`);
      if (!integrationResponse.ok) throw new Error(integrationBody.error || `HTTP ${integrationResponse.status}`);
      setIdentities(identityBody.data ?? []);
      setIntegrations(integrationBody.data ?? []);
      if (identityId && !(identityBody.data ?? []).some((item) => item.id === identityId && item.status === "DRAFT")) setIdentityId("");
      if (integrationId && !(integrationBody.data ?? []).some((item) => item.id === integrationId && item.status === "DRAFT")) setIntegrationId("");
    } catch (cause) {
      setNotice({ kind: "error", text: cause instanceof Error ? cause.message : c("Connection metadata could not be loaded.", "Bağlantı metadatası yüklenemedi.") });
    } finally {
      setLoading(false);
    }
  }, [identityId, integrationId, tr]);

  useEffect(() => { void load(); }, [load]);

  async function saveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!identity) return;
    const form = new FormData(event.currentTarget);
    setBusy("identity");
    setNotice(null);
    try {
      const response = await fetch(`/api/settings/identity/${encodeURIComponent(identity.id)}/metadata`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: identity.updatedAt,
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
      setNotice({ kind: "ok", text: c("Identity-provider draft metadata updated.", "Kimlik sağlayıcı taslak metadatası güncellendi.") });
      await load();
    } catch (cause) {
      setNotice({ kind: "error", text: cause instanceof Error ? cause.message : c("Identity-provider metadata could not be updated.", "Kimlik sağlayıcı metadatası güncellenemedi.") });
    } finally {
      setBusy(null);
    }
  }

  async function saveIntegration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!integration) return;
    const form = new FormData(event.currentTarget);
    setBusy("integration");
    setNotice(null);
    try {
      const response = await fetch(`/api/settings/integrations/${encodeURIComponent(integration.id)}/metadata`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: integration.updatedAt,
          name: form.get("name"),
          systemType: form.get("systemType"),
          baseUrl: form.get("baseUrl"),
          authType: form.get("authType"),
          secretRef: form.get("secretRef"),
          scopes: splitScopes(String(form.get("scopes") ?? ""))
        })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setNotice({ kind: "ok", text: c("Integration draft metadata updated.", "Entegrasyon taslak metadatası güncellendi.") });
      await load();
    } catch (cause) {
      setNotice({ kind: "error", text: cause instanceof Error ? cause.message : c("Integration metadata could not be updated.", "Entegrasyon metadatası güncellenemedi.") });
    } finally {
      setBusy(null);
    }
  }

  return <section className="connection-metadata-editor">
    <div className="settings-connections-heading">
      <div>
        <span className="section-kicker">{c("Draft metadata control", "Taslak metadata kontrolü")}</span>
        <h2>{c("Edit connection metadata", "Bağlantı metadatasını düzenle")}</h2>
        <p>{c("Only DRAFT connections are editable. Active or disabled connections must be reopened before metadata can change.", "Yalnızca DRAFT bağlantılar düzenlenebilir. Aktif veya devre dışı bağlantılar metadata değişikliği öncesinde taslağa geri açılmalıdır.")}</p>
      </div>
      <button type="button" className="secondary-button compact" onClick={() => void load()} disabled={loading}><RefreshCw size={14}/>{c("Refresh","Yenile")}</button>
    </div>

    {notice ? <div className={`settings-policy-message ${notice.kind}`}>{notice.text}</div> : null}

    <div className="settings-connections-grid">
      <div className="card settings-connection-form">
        <div className="settings-connection-title"><KeyRound size={18}/><div><strong>{c("Identity provider draft", "Kimlik sağlayıcı taslağı")}</strong><small>{c("Edit activation metadata without changing an active provider in place.", "Aktif sağlayıcıyı yerinde değiştirmeden aktivasyon metadatasını düzenleyin.")}</small></div></div>
        <label className="connection-edit-select">{c("Draft provider", "Taslak sağlayıcı")}
          <select value={identityId} onChange={(event) => setIdentityId(event.target.value)}>
            <option value="">{c("Select a DRAFT identity provider", "DRAFT kimlik sağlayıcı seç")}</option>
            {draftIdentities.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.type}</option>)}
          </select>
        </label>
        {identity ? <form onSubmit={saveIdentity}>
          <div className="settings-connection-fields">
            <label>{c("Name","Ad")}<input name="name" maxLength={120} required defaultValue={identity.name} key={`${identity.id}:name`}/></label>
            <label>{c("Type","Tür")}<select name="type" defaultValue={identity.type} key={`${identity.id}:type`}>{identityTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_"," ")}</option>)}</select></label>
            <label className="wide">Issuer / LDAP endpoint<input name="issuer" maxLength={1024} defaultValue={identity.issuer ?? ""} key={`${identity.id}:issuer`}/></label>
            <label className="wide">SAML metadata URL<input name="metadataUrl" maxLength={1024} defaultValue={identity.metadataUrl ?? ""} key={`${identity.id}:metadata`}/></label>
            <label>Client ID<input name="clientId" maxLength={256} defaultValue={identity.clientId ?? ""} key={`${identity.id}:client`}/></label>
            <label>{c("Directory tenant ID","Directory tenant ID")}<input name="directoryTenantId" maxLength={191} defaultValue={identity.directoryTenantId ?? ""} key={`${identity.id}:tenant`}/></label>
            <label className="wide">Secret reference<input name="secretRef" maxLength={512} defaultValue={identity.secretRef ?? ""} key={`${identity.id}:secret`}/></label>
          </div>
          <div className="settings-connection-flags">
            <label><input name="scimEnabled" type="checkbox" defaultChecked={identity.scimEnabled} key={`${identity.id}:scim`}/><span>SCIM</span></label>
            <label><input name="jitEnabled" type="checkbox" defaultChecked={identity.jitEnabled} key={`${identity.id}:jit`}/><span>JIT</span></label>
            <label><input name="mfaRequired" type="checkbox" defaultChecked={identity.mfaRequired} key={`${identity.id}:mfa`}/><span>{c("MFA required","MFA zorunlu")}</span></label>
          </div>
          <button className="create-button" type="submit" disabled={busy === "identity"}><Save size={15}/>{busy === "identity" ? c("Saving…","Kaydediliyor…") : c("Save identity draft","Kimlik taslağını kaydet")}</button>
        </form> : <p className="connection-edit-empty">{c("Choose a DRAFT provider to edit its metadata.", "Metadatasını düzenlemek için DRAFT sağlayıcı seçin.")}</p>}
      </div>

      <div className="card settings-connection-form">
        <div className="settings-connection-title"><Link2 size={18}/><div><strong>{c("Integration draft", "Entegrasyon taslağı")}</strong><small>{c("Update endpoint, auth reference and scopes before governed activation.", "Yönetişimli aktivasyon öncesinde endpoint, kimlik referansı ve scope alanlarını güncelleyin.")}</small></div></div>
        <label className="connection-edit-select">{c("Draft integration", "Taslak entegrasyon")}
          <select value={integrationId} onChange={(event) => setIntegrationId(event.target.value)}>
            <option value="">{c("Select a DRAFT integration", "DRAFT entegrasyon seç")}</option>
            {draftIntegrations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.systemType}</option>)}
          </select>
        </label>
        {integration ? <form onSubmit={saveIntegration}>
          <div className="settings-connection-fields">
            <label>{c("Name","Ad")}<input name="name" maxLength={120} required defaultValue={integration.name} key={`${integration.id}:name`}/></label>
            <label>{c("System type","Sistem türü")}<input name="systemType" maxLength={120} required defaultValue={integration.systemType} key={`${integration.id}:system`}/></label>
            <label className="wide">Base URL<input name="baseUrl" maxLength={1024} defaultValue={integration.baseUrl ?? ""} key={`${integration.id}:base`}/></label>
            <label>{c("Authentication type","Kimlik doğrulama türü")}<input name="authType" maxLength={80} required defaultValue={integration.authType} key={`${integration.id}:auth`}/></label>
            <label>Secret reference<input name="secretRef" maxLength={512} defaultValue={integration.secretRef ?? ""} key={`${integration.id}:secret`}/></label>
            <label className="wide">{c("Scopes (comma or space separated)","Scope'lar (virgül veya boşlukla ayrılmış)")}<input name="scopes" maxLength={4000} defaultValue={scopeText(integration.scopes)} key={`${integration.id}:scopes`}/></label>
          </div>
          <button className="create-button" type="submit" disabled={busy === "integration"}><Save size={15}/>{busy === "integration" ? c("Saving…","Kaydediliyor…") : c("Save integration draft","Entegrasyon taslağını kaydet")}</button>
        </form> : <p className="connection-edit-empty">{c("Choose a DRAFT integration to edit its metadata.", "Metadatasını düzenlemek için DRAFT entegrasyon seçin.")}</p>}
      </div>
    </div>
  </section>;
}
