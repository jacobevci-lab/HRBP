"use client";

import { AlertTriangle, Save, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";

type SecurityPolicyValue = {
  dataRegion: string;
  kmsKeyRef?: string | null;
  customerManagedKey: boolean;
  mfaRequired: boolean;
  sessionMaxMinutes: number;
  exportRestrictedData: boolean;
  downloadWatermarking: boolean;
  deviceTrustRequired: boolean;
  breakGlassEnabled: boolean;
};

function Toggle({ checked, disabled, label, detail, onChange }: { checked: boolean; disabled?: boolean; label: string; detail: string; onChange: (value: boolean) => void }) {
  return <label className="settings-policy-toggle">
    <span><strong>{label}</strong><small>{detail}</small></span>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)}/>
    <i aria-hidden="true"/>
  </label>;
}

export function SecurityPolicyEditor({ initial, canWrite, assurance }: { initial: SecurityPolicyValue; canWrite: boolean; assurance: { mfaConfigured: boolean; deviceTrustConfigured: boolean } }) {
  const { locale } = useLocale();
  const router = useRouter();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const weakened = useMemo(() => !value.mfaRequired || value.exportRestrictedData || !value.downloadWatermarking || !value.breakGlassEnabled, [value]);
  const assuranceMissing = (value.mfaRequired && !assurance.mfaConfigured) || (value.deviceTrustRequired && !assurance.deviceTrustConfigured);

  function patch<K extends keyof SecurityPolicyValue>(key: K, next: SecurityPolicyValue[K]) {
    setValue((current) => ({ ...current, [key]: next }));
    setMessage(null);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/security-policy", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value)
      });
      const body = await response.json() as { data?: SecurityPolicyValue; error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      if (body.data) setValue(body.data);
      setMessage({ kind: "ok", text: c("Tenant security policy saved and audited.", "Tenant güvenlik politikası kaydedildi ve denetim kaydına işlendi.") });
      router.refresh();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : c("Security policy could not be saved.", "Güvenlik politikası kaydedilemedi.") });
    } finally {
      setBusy(false);
    }
  }

  return <form className="settings-policy-editor" onSubmit={save}>
    <div className="settings-policy-editor-head">
      <div><span className="section-kicker">{c("Tenant security", "Tenant güvenliği")}</span><h3>{c("Enforced posture", "Uygulanan duruş")}</h3></div>
      <ShieldCheck size={18}/>
    </div>

    {weakened ? <div className="settings-policy-warning"><AlertTriangle size={15}/><span>{c("One or more controls reduce the recommended tenant baseline. Confirm the business requirement before saving.", "Bir veya daha fazla kontrol önerilen tenant güvenlik tabanını zayıflatıyor. Kaydetmeden önce iş gereksinimini doğrulayın.")}</span></div> : null}
    {assuranceMissing ? <div className="settings-policy-warning"><AlertTriangle size={15}/><span>{c("A required authentication assurance control has no configured OIDC claim mapping. The policy cannot be saved or satisfied until the mapping is configured.", "Zorunlu kimlik doğrulama assurance kontrolü için OIDC claim eşlemesi yapılandırılmamış. Eşleme tamamlanana kadar politika kaydedilemez veya karşılanamaz.")}</span></div> : null}

    <div className="settings-policy-fields">
      <label>{c("Data region", "Veri bölgesi")}<input value={value.dataRegion} maxLength={64} disabled={!canWrite || busy} onChange={(event) => patch("dataRegion", event.target.value)} required/></label>
      <label>{c("Maximum session (minutes)", "Maksimum oturum (dakika)")}<input type="number" min={15} max={1440} step={1} value={value.sessionMaxMinutes} disabled={!canWrite || busy} onChange={(event) => patch("sessionMaxMinutes", Number(event.target.value))} required/></label>
    </div>

    <div className="settings-policy-toggles">
      <Toggle checked={value.mfaRequired} disabled={!canWrite || busy || (!assurance.mfaConfigured && !value.mfaRequired)} onChange={(next) => patch("mfaRequired", next)} label={c("Require MFA", "MFA zorunlu")} detail={assurance.mfaConfigured ? c("Require OIDC sign-in evidence matching the configured MFA claim/value mapping. Existing sessions are rechecked on every request.", "Yapılandırılmış MFA claim/değer eşlemesini karşılayan OIDC giriş kanıtını zorunlu kılar. Mevcut oturumlar her istekte yeniden kontrol edilir.") : c("OIDC MFA claim/value mapping is not configured.", "OIDC MFA claim/değer eşlemesi yapılandırılmamış.")}/>
      <Toggle checked={value.deviceTrustRequired} disabled={!canWrite || busy || (!assurance.deviceTrustConfigured && !value.deviceTrustRequired)} onChange={(next) => patch("deviceTrustRequired", next)} label={c("Require trusted device", "Güvenilir cihaz zorunlu")} detail={assurance.deviceTrustConfigured ? c("Require OIDC sign-in evidence matching the configured trusted-device claim/value mapping.", "Yapılandırılmış güvenilir cihaz claim/değer eşlemesini karşılayan OIDC giriş kanıtını zorunlu kılar.") : c("OIDC device-trust claim/value mapping is not configured.", "OIDC cihaz güveni claim/değer eşlemesi yapılandırılmamış.")}/>
      <Toggle checked={value.downloadWatermarking} disabled={!canWrite || busy} onChange={(next) => patch("downloadWatermarking", next)} label={c("Download watermarking", "İndirme filigranı")} detail={c("Apply watermark controls to governed document downloads.", "Yönetişim kapsamındaki doküman indirmelerine filigran uygula.")}/>
      <Toggle checked={value.exportRestrictedData} disabled={!canWrite || busy} onChange={(next) => patch("exportRestrictedData", next)} label={c("Allow restricted-data export", "Kısıtlı veri dışa aktarımına izin ver")} detail={c("Permit export of restricted classifications for authorized users.", "Yetkili kullanıcıların kısıtlı sınıflandırmaları dışa aktarmasına izin ver.")}/>
      <Toggle checked={value.breakGlassEnabled} disabled={!canWrite || busy} onChange={(next) => patch("breakGlassEnabled", next)} label={c("Break-glass access", "Break-glass erişimi")} detail={c("Keep emergency administrative recovery capability enabled.", "Acil durum yönetici kurtarma erişimini etkin tut.")}/>
      <Toggle checked={value.customerManagedKey} disabled={!canWrite || busy} onChange={(next) => patch("customerManagedKey", next)} label={c("Customer-managed encryption key", "Müşteri yönetimli şifreleme anahtarı")} detail={c("Reference a tenant-controlled KMS key instead of the platform-managed default.", "Platform varsayılanı yerine tenant kontrollü KMS anahtarına referans ver.")}/>
    </div>

    {value.customerManagedKey ? <label className="settings-policy-kms">{c("KMS key reference", "KMS anahtar referansı")}<input value={value.kmsKeyRef ?? ""} maxLength={512} disabled={!canWrite || busy} onChange={(event) => patch("kmsKeyRef", event.target.value)} placeholder="vault://tenant/kms-key" required/></label> : null}

    {message ? <div className={`settings-policy-message ${message.kind}`}>{message.text}</div> : null}
    <div className="settings-policy-footer">
      <small>{canWrite ? c("Changes are tenant-scoped and appended to the immutable audit ledger.", "Değişiklikler tenant kapsamındadır ve değiştirilemez denetim kaydına eklenir.") : c("Read-only access. settings:write is required to change these controls.", "Salt-okunur erişim. Bu kontrolleri değiştirmek için settings:write gerekir.")}</small>
      {canWrite ? <button className="create-button" type="submit" disabled={busy}><Save size={15}/>{busy ? c("Saving…", "Kaydediliyor…") : c("Save security policy", "Güvenlik politikasını kaydet")}</button> : null}
    </div>
  </form>;
}
