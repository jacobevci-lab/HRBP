import { Activity, BellRing, CloudCog, Database, KeyRound, Link2, LockKeyhole, ShieldCheck, UsersRound, Workflow } from "lucide-react";
import { AccessScopeAdmin } from "@/components/access-scope-admin";
import { JurisdictionAdmin } from "@/components/jurisdiction-admin";
import { NotificationDeadLetterAction } from "@/components/notification-dead-letter-action";
import { authConfigurationStatus, getOidcConfig } from "@/lib/auth-config";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n-server";
import { runtimeString } from "@/lib/runtime-env";
import { getServerRequestContext } from "@/lib/server-session";

function c(locale: "en" | "tr", en: string, tr: string) {
  return locale === "tr" ? tr : en;
}

function fmt(locale: "en" | "tr", value: Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="settings-live-metric card"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{meta}</p></div></div>;
}

function State({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`settings-live-state ${ok ? "ok" : "attention"}`}>{label}</span>;
}

export async function SettingsLivePage() {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx || !can(ctx, "settings:read")) {
    return <section className="card settings-access-denied"><LockKeyhole size={28}/><h2>{c(locale, "Settings access is restricted", "Ayarlar erişimi kısıtlı")}</h2><p>{c(locale, "Your authenticated role does not include tenant settings visibility.", "Kimliği doğrulanmış rolünüz tenant ayarlarını görüntüleme yetkisini içermiyor.")}</p></section>;
  }

  const auth = authConfigurationStatus();
  const oidc = getOidcConfig();
  const canWrite = can(ctx, "settings:write");
  const storageConfigured = Boolean(runtimeString("OBJECT_STORAGE_ENDPOINT") && runtimeString("OBJECT_STORAGE_ACCESS_KEY") && runtimeString("OBJECT_STORAGE_SECRET_KEY") && runtimeString("OBJECT_STORAGE_BUCKET"));
  const scanConfigured = Boolean(runtimeString("HRBP_DOCUMENT_SCAN_TOKEN"));
  const maintenanceConfigured = Boolean(runtimeString("HRBP_MAINTENANCE_TOKEN"));

  const [tenant, security, idps, integrations, userGroups, notificationGroups, activeQueues, workflowGroups, quarantineCount] = await Promise.all([
    db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { id: true, name: true, region: true, createdAt: true } }),
    db.tenantSecurityPolicy.findUnique({ where: { tenantId: ctx.tenantId } }),
    db.identityProviderConnection.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ status: "asc" }, { name: "asc" }], take: 50 }),
    db.integrationConnection.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ enabled: "desc" }, { name: "asc" }], take: 100 }),
    db.userAccount.groupBy({ by: ["role", "active"], where: { tenantId: ctx.tenantId }, _count: { _all: true } }),
    db.notificationOutbox.groupBy({ by: ["status"], where: { tenantId: ctx.tenantId }, _count: { _all: true } }),
    db.hRServiceQueue.count({ where: { tenantId: ctx.tenantId, active: true } }),
    db.workflowDefinition.groupBy({ by: ["status"], where: { tenantId: ctx.tenantId }, _count: { _all: true } }),
    db.documentVersion.count({ where: { tenantId: ctx.tenantId, scanStatus: { in: ["PENDING", "QUARANTINED", "FAILED"] } } })
  ]);

  const activeUsers = userGroups.filter((row) => row.active).reduce((sum, row) => sum + row._count._all, 0);
  const inactiveUsers = userGroups.filter((row) => !row.active).reduce((sum, row) => sum + row._count._all, 0);
  const notificationCounts = Object.fromEntries(notificationGroups.map((row) => [row.status, row._count._all])) as Record<string, number>;
  const workflowCounts = Object.fromEntries(workflowGroups.map((row) => [row.status, row._count._all])) as Record<string, number>;
  const healthyIntegrations = integrations.filter((row) => row.enabled && row.status === "ACTIVE").length;
  const attentionIntegrations = integrations.filter((row) => row.status === "DEGRADED" || (row.enabled && row.status !== "ACTIVE")).length;
  const deadLetters = notificationCounts.DEAD_LETTER ?? 0;
  const notificationBacklog = (notificationCounts.PENDING ?? 0) + (notificationCounts.FAILED ?? 0) + (notificationCounts.PROCESSING ?? 0);

  return <div className="settings-live-page">
    <div className="page-heading settings-live-heading">
      <div>
        <span className="eyebrow">{c(locale, "Tenant control plane", "Tenant kontrol düzlemi")}</span>
        <h1>{c(locale, "Settings & Operations", "Ayarlar & Operasyon")}</h1>
        <p>{tenant ? `${tenant.name} · ${tenant.region}` : ctx.tenantId}</p>
      </div>
      <State ok={auth.configured && storageConfigured && maintenanceConfigured} label={auth.configured && storageConfigured && maintenanceConfigured ? c(locale, "Core configuration healthy", "Temel yapılandırma sağlıklı") : c(locale, "Configuration attention required", "Yapılandırma için aksiyon gerekli")}/>
    </div>

    <section className="settings-live-metrics">
      <Metric icon={<UsersRound size={18}/>} label={c(locale, "Active identities", "Aktif kimlikler")} value={String(activeUsers)} meta={c(locale, `${inactiveUsers} inactive accounts`, `${inactiveUsers} pasif hesap`)}/>
      <Metric icon={<Link2 size={18}/>} label={c(locale, "Enabled integrations", "Etkin entegrasyonlar")} value={String(integrations.filter((row) => row.enabled).length)} meta={c(locale, `${healthyIntegrations} healthy · ${attentionIntegrations} attention`, `${healthyIntegrations} sağlıklı · ${attentionIntegrations} dikkat`)}/>
      <Metric icon={<Workflow size={18}/>} label={c(locale, "Active workflows", "Aktif iş akışları")} value={String(workflowCounts.ACTIVE ?? 0)} meta={c(locale, `${activeQueues} service queues`, `${activeQueues} hizmet kuyruğu`)}/>
      <Metric icon={<BellRing size={18}/>} label={c(locale, "Notification backlog", "Bildirim birikimi")} value={String(notificationBacklog)} meta={c(locale, `${deadLetters} dead letter`, `${deadLetters} dead-letter`)}/>
    </section>

    <section className="settings-live-grid">
      <div className="card settings-live-panel">
        <div className="settings-live-panel-head"><div><span className="section-kicker">{c(locale, "Runtime readiness", "Çalışma zamanı hazırlığı")}</span><h3>{c(locale, "Security-critical configuration", "Güvenlik kritik yapılandırma")}</h3></div><ShieldCheck size={18}/></div>
        <div className="settings-live-checks">
          <div><KeyRound size={17}/><span><strong>Enterprise OIDC</strong><small>{auth.configured ? c(locale, "Issuer, client, tenant and session secret configured", "Issuer, client, tenant ve session secret yapılandırılmış") : c(locale, `Missing: ${auth.missing.join(", ")}`, `Eksik: ${auth.missing.join(", ")}`)}</small></span><State ok={auth.configured} label={auth.configured ? c(locale, "Ready", "Hazır") : c(locale, "Attention", "Dikkat")}/></div>
          <div><CloudCog size={17}/><span><strong>{c(locale, "Private object storage", "Özel nesne depolama")}</strong><small>{c(locale, "Endpoint, bucket and credentials are checked without exposing their values.", "Endpoint, bucket ve kimlik bilgileri değerleri gösterilmeden kontrol edilir.")}</small></span><State ok={storageConfigured} label={storageConfigured ? c(locale, "Ready", "Hazır") : c(locale, "Missing", "Eksik")}/></div>
          <div><Activity size={17}/><span><strong>{c(locale, "Document malware scan", "Doküman zararlı yazılım taraması")}</strong><small>{c(locale, `${quarantineCount} versions currently require scan/quarantine attention.`, `${quarantineCount} sürüm tarama/karantina aksiyonu gerektiriyor.`)}</small></span><State ok={scanConfigured} label={scanConfigured ? c(locale, "Configured", "Yapılandırıldı") : c(locale, "Missing", "Eksik")}/></div>
          <div><Database size={17}/><span><strong>{c(locale, "Scheduled maintenance", "Zamanlanmış bakım")}</strong><small>{c(locale, "SLA escalation, workflow reminders, notification dispatch and retention.", "SLA eskalasyonu, iş akışı hatırlatmaları, bildirim dağıtımı ve retention.")}</small></span><State ok={maintenanceConfigured} label={maintenanceConfigured ? c(locale, "Protected", "Korumalı") : c(locale, "Token missing", "Token eksik")}/></div>
        </div>
      </div>

      <aside className="card settings-live-panel settings-security-policy">
        <div className="settings-live-panel-head"><div><span className="section-kicker">{c(locale, "Tenant security", "Tenant güvenliği")}</span><h3>{c(locale, "Enforced posture", "Uygulanan duruş")}</h3></div><LockKeyhole size={18}/></div>
        <dl>
          <div><dt>MFA</dt><dd>{security?.mfaRequired !== false ? c(locale, "Required", "Zorunlu") : c(locale, "Optional", "Opsiyonel")}</dd></div>
          <div><dt>{c(locale, "Session maximum", "Maksimum oturum")}</dt><dd>{security?.sessionMaxMinutes ?? 480} min</dd></div>
          <div><dt>{c(locale, "Restricted export", "Kısıtlı dışa aktarma")}</dt><dd>{security?.exportRestrictedData ? c(locale, "Allowed", "İzinli") : c(locale, "Blocked", "Engelli")}</dd></div>
          <div><dt>{c(locale, "Watermarking", "Filigran")}</dt><dd>{security?.downloadWatermarking !== false ? c(locale, "Enabled", "Etkin") : c(locale, "Disabled", "Devre dışı")}</dd></div>
          <div><dt>{c(locale, "Device trust", "Cihaz güveni")}</dt><dd>{security?.deviceTrustRequired ? c(locale, "Required", "Zorunlu") : c(locale, "Not required", "Zorunlu değil")}</dd></div>
          <div><dt>Break glass</dt><dd>{security?.breakGlassEnabled !== false ? c(locale, "Enabled", "Etkin") : c(locale, "Disabled", "Devre dışı")}</dd></div>
          <div><dt>{c(locale, "Data region", "Veri bölgesi")}</dt><dd>{security?.dataRegion ?? tenant?.region ?? "—"}</dd></div>
        </dl>
      </aside>
    </section>

    <section className="settings-live-grid two">
      <div className="card settings-live-panel">
        <div className="settings-live-panel-head"><div><span className="section-kicker">{c(locale, "Identity & provisioning", "Kimlik & provisioning")}</span><h3>{c(locale, "Configured identity providers", "Yapılandırılmış kimlik sağlayıcıları")}</h3></div><KeyRound size={18}/></div>
        <div className="settings-live-table-wrap"><table className="settings-live-table"><thead><tr><th>{c(locale, "Name", "Ad")}</th><th>{c(locale, "Type", "Tür")}</th><th>SCIM</th><th>JIT</th><th>MFA</th><th>{c(locale, "Validated", "Doğrulandı")}</th><th>{c(locale, "Status", "Durum")}</th></tr></thead><tbody>
          {idps.length ? idps.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.type.replaceAll("_", " ")}</td><td>{row.scimEnabled ? c(locale, "On", "Açık") : c(locale, "Off", "Kapalı")}</td><td>{row.jitEnabled ? c(locale, "On", "Açık") : c(locale, "Off", "Kapalı")}</td><td>{row.mfaRequired ? c(locale, "Required", "Zorunlu") : c(locale, "Optional", "Opsiyonel")}</td><td>{fmt(locale, row.lastValidatedAt)}</td><td><State ok={row.status === "ACTIVE"} label={row.status}/></td></tr>) : <tr><td colSpan={7} className="settings-live-empty">{auth.configured ? c(locale, "Runtime OIDC is configured; no database identity-provider records exist yet.", "Runtime OIDC yapılandırılmış; henüz veritabanı kimlik sağlayıcı kaydı yok.") : c(locale, "No identity provider is configured.", "Kimlik sağlayıcı yapılandırılmamış.")}</td></tr>}
        </tbody></table></div>
        {oidc ? <p className="settings-live-footnote">{c(locale, "Runtime OIDC", "Runtime OIDC")}: {oidc.issuer} · JIT {oidc.jitProvisioning ? "on" : "off"} · {oidc.allowedEmailDomains.length} {c(locale, "allowed domains", "izinli domain")}</p> : null}
      </div>

      <div className="card settings-live-panel">
        <div className="settings-live-panel-head"><div><span className="section-kicker">{c(locale, "Connected systems", "Bağlı sistemler")}</span><h3>{c(locale, "Live integration registry", "Canlı entegrasyon kaydı")}</h3></div><Link2 size={18}/></div>
        <div className="settings-live-table-wrap"><table className="settings-live-table"><thead><tr><th>{c(locale, "Connection", "Bağlantı")}</th><th>{c(locale, "System", "Sistem")}</th><th>{c(locale, "Auth", "Kimlik")}</th><th>{c(locale, "Enabled", "Etkin")}</th><th>{c(locale, "Last sync", "Son senkron")}</th><th>{c(locale, "Status", "Durum")}</th></tr></thead><tbody>
          {integrations.length ? integrations.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.systemType}</td><td>{row.authType}</td><td>{row.enabled ? c(locale, "Yes", "Evet") : c(locale, "No", "Hayır")}</td><td>{fmt(locale, row.lastSyncAt)}</td><td><State ok={row.status === "ACTIVE" && row.enabled} label={row.status}/></td></tr>) : <tr><td colSpan={6} className="settings-live-empty">{c(locale, "No integration connections registered for this tenant.", "Bu tenant için kayıtlı entegrasyon bağlantısı yok.")}</td></tr>}
        </tbody></table></div>
      </div>
    </section>

    <section className="card settings-live-panel settings-notification-ops">
      <div className="settings-live-panel-head"><div><span className="section-kicker">{c(locale, "Notification operations", "Bildirim operasyonları")}</span><h3>{c(locale, "Durable outbox health", "Dayanıklı outbox sağlığı")}</h3></div><BellRing size={18}/></div>
      <div className="settings-notification-counts">
        {["PENDING", "PROCESSING", "FAILED", "DEAD_LETTER", "DELIVERED"].map((status) => <div key={status}><small>{status.replaceAll("_", " ")}</small><strong>{notificationCounts[status] ?? 0}</strong></div>)}
      </div>
      {canWrite ? <NotificationDeadLetterAction count={deadLetters}/> : <p className="settings-live-footnote">{c(locale, "Read-only settings access: dead-letter retry requires settings:write.", "Salt-okunur ayar erişimi: dead-letter yeniden deneme settings:write gerektirir.")}</p>}
    </section>

    {canWrite ? <><AccessScopeAdmin/><JurisdictionAdmin/></> : null}
  </div>;
}
