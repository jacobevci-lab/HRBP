import { Activity, BellRing, CloudCog, Database, KeyRound, Link2, LockKeyhole, ShieldCheck, UsersRound, Workflow } from "lucide-react";
import { AccessScopeAdmin } from "@/components/access-scope-admin";
import { EmergencyAccessAdmin } from "@/components/emergency-access-admin";
import { JurisdictionAdmin } from "@/components/jurisdiction-admin";
import { LocalAccountAdmin } from "@/components/local-account-admin";
import { NotificationDeadLetterAction } from "@/components/notification-dead-letter-action";
import { NotificationOperationsConsole } from "@/components/notification-operations-console";
import { SmtpTestAction } from "@/components/smtp-test-action";
import { SessionRevocationAdmin } from "@/components/session-revocation-admin";
import { ScimRoleMappingAdmin } from "@/components/scim-role-mapping-admin";
import { authConfigurationStatus, getOidcConfig } from "@/lib/auth-config";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n-server";
import { parseIntegrationProbeOrigins } from "@/lib/integration-live-validation.mjs";
import { runtimeBoolean, runtimeString } from "@/lib/runtime-env";
import { identityRuntimeActivationIssues, isOidcRuntimeProvider } from "@/lib/runtime-identity-provider";
import { scimRuntimeConfig } from "@/lib/scim";
import { smtpConfigurationStatus } from "@/lib/notification-email-config";
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
  const localAuthRuntimeEnabled = runtimeBoolean("HRBP_LOCAL_AUTH_ENABLED", false);
  const smtp = smtpConfigurationStatus();
  const scim = scimRuntimeConfig();
  const integrationProbeAllowHttp = runtimeBoolean("HRBP_INTEGRATION_PROBE_ALLOW_HTTP", false);
  const integrationProbeOrigins = parseIntegrationProbeOrigins(runtimeString("HRBP_INTEGRATION_PROBE_ALLOWED_ORIGINS") ?? "", integrationProbeAllowHttp) ?? [];
  const integrationProbeConfigured = integrationProbeOrigins.length > 0;
  const baseCoreConfigured = auth.configured && storageConfigured && maintenanceConfigured && (!scim.enabled || scim.configured);

  const localAuthSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [tenant, security, idps, integrations, userGroups, notificationGroups, activeQueues, workflowGroups, quarantineCount, localAccountCount, localAuthEvents, localAuthEventGroups, localAuthUsers, scimManagedCount, scimActiveCount, scimLastProvisioning, scimGroupCount, scimMembershipCount, scimLastGroupChange] = await Promise.all([
    db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { id: true, name: true, region: true, createdAt: true } }),
    db.tenantSecurityPolicy.findUnique({ where: { tenantId: ctx.tenantId } }),
    db.identityProviderConnection.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ status: "asc" }, { name: "asc" }], take: 50 }),
    db.integrationConnection.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ enabled: "desc" }, { name: "asc" }], take: 100 }),
    db.userAccount.groupBy({ by: ["role", "active"], where: { tenantId: ctx.tenantId }, _count: { _all: true } }),
    db.notificationOutbox.groupBy({ by: ["status"], where: { tenantId: ctx.tenantId }, _count: { _all: true } }),
    db.hRServiceQueue.count({ where: { tenantId: ctx.tenantId, active: true } }),
    db.workflowDefinition.groupBy({ by: ["status"], where: { tenantId: ctx.tenantId }, _count: { _all: true } }),
    db.documentVersion.count({ where: { tenantId: ctx.tenantId, scanStatus: { in: ["PENDING", "QUARANTINED", "FAILED"] } } }),
    db.userAccount.count({ where: { tenantId: ctx.tenantId, active: true, localAuthEnabled: true, localPasswordHash: { not: null } } }),
    db.auditEvent.findMany({
      where: { tenantId: ctx.tenantId, resourceType: "UserAccount", action: { in: ["auth.local-succeeded", "auth.local-failed", "auth.local-locked"] } },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { id: true, action: true, resourceId: true, purpose: true, occurredAt: true }
    }),
    db.auditEvent.groupBy({
      by: ["action"],
      where: { tenantId: ctx.tenantId, resourceType: "UserAccount", action: { in: ["auth.local-succeeded", "auth.local-failed", "auth.local-locked"] }, occurredAt: { gte: localAuthSince } },
      _count: { _all: true }
    }),
    db.userAccount.findMany({
      where: { tenantId: ctx.tenantId, OR: [{ localAuthEnabled: true }, { localPasswordHash: { not: null } }] },
      take: 200,
      select: { id: true, subject: true, displayName: true }
    }),
    db.userAccount.count({ where: { tenantId: ctx.tenantId, provisioningSource: "SCIM" } }),
    db.userAccount.count({ where: { tenantId: ctx.tenantId, provisioningSource: "SCIM", active: true } }),
    db.userAccount.findFirst({
      where: { tenantId: ctx.tenantId, provisioningSource: "SCIM" },
      orderBy: [{ provisioningUpdatedAt: "desc" }, { id: "asc" }],
      select: { provisioningUpdatedAt: true }
    }),
    db.scimGroup.count({ where: { tenantId: ctx.tenantId } }),
    db.scimGroupMember.count({ where: { tenantId: ctx.tenantId } }),
    db.scimGroup.findFirst({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: { updatedAt: true }
    })
  ]);

  const activeRuntimeIdps = idps.filter((row) => row.status === "ACTIVE" && isOidcRuntimeProvider(row.type));
  const managedOidc = activeRuntimeIdps.length === 1 ? activeRuntimeIdps[0] : null;
  const identityRuntimeIssues = activeRuntimeIdps.length > 1
    ? [c(locale, "multiple active OIDC-family providers", "birden fazla aktif OIDC ailesi sağlayıcısı")]
    : managedOidc
      ? identityRuntimeActivationIssues(managedOidc)
      : [];
  const identityRuntimeHealthy = auth.configured && identityRuntimeIssues.length === 0;
  const effectiveJit = managedOidc ? managedOidc.jitEnabled : Boolean(oidc?.jitProvisioning);
  const effectiveProviderMfa = Boolean(managedOidc?.mfaRequired);
  const coreConfigured = baseCoreConfigured && identityRuntimeHealthy;

  const activeUsers = userGroups.filter((row) => row.active).reduce((sum, row) => sum + row._count._all, 0);
  const inactiveUsers = userGroups.filter((row) => !row.active).reduce((sum, row) => sum + row._count._all, 0);
  const notificationCounts = Object.fromEntries(notificationGroups.map((row) => [row.status, row._count._all])) as Record<string, number>;
  const workflowCounts = Object.fromEntries(workflowGroups.map((row) => [row.status, row._count._all])) as Record<string, number>;
  const healthyIntegrations = integrations.filter((row) => row.enabled && row.status === "ACTIVE").length;
  const attentionIntegrations = integrations.filter((row) => row.status === "DEGRADED" || (row.enabled && row.status !== "ACTIVE")).length;
  const deadLetters = notificationCounts.DEAD_LETTER ?? 0;
  const notificationBacklog = (notificationCounts.PENDING ?? 0) + (notificationCounts.FAILED ?? 0) + (notificationCounts.PROCESSING ?? 0);
  const localAuthCounts = Object.fromEntries(localAuthEventGroups.map((row) => [row.action, row._count._all])) as Record<string, number>;
  const localAuthAccountNames = new Map(localAuthUsers.map((row) => [row.id, `${row.displayName} · ${row.subject}`]));
  const localAuthSuccess24h = localAuthCounts["auth.local-succeeded"] ?? 0;
  const localAuthFailure24h = localAuthCounts["auth.local-failed"] ?? 0;
  const localAuthLocked24h = localAuthCounts["auth.local-locked"] ?? 0;

  return <div className="settings-live-page">
    <div className="page-heading settings-live-heading">
      <div>
        <span className="eyebrow">{c(locale, "Tenant control plane", "Tenant kontrol düzlemi")}</span>
        <h1>{c(locale, "Settings & Operations", "Ayarlar & Operasyon")}</h1>
        <p>{tenant ? `${tenant.name} · ${tenant.region}` : ctx.tenantId}</p>
      </div>
      <State ok={coreConfigured} label={coreConfigured ? c(locale, "Core configuration healthy", "Temel yapılandırma sağlıklı") : c(locale, "Configuration attention required", "Yapılandırma için aksiyon gerekli")}/>
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
          <div><KeyRound size={17}/><span><strong>Enterprise OIDC</strong><small>{!auth.configured ? c(locale, `Missing: ${auth.missing.join(", ")}`, `Eksik: ${auth.missing.join(", ")}`) : identityRuntimeIssues.length ? c(locale, `Governed runtime attention: ${identityRuntimeIssues.join(", ")}`, `Yönetişimli runtime aksiyonu: ${identityRuntimeIssues.join(", ")}`) : managedOidc ? c(locale, `${managedOidc.name} is bound to runtime · JIT ${effectiveJit ? "on" : "off"} · provider MFA ${effectiveProviderMfa ? "required" : "optional"}`, `${managedOidc.name} runtime ile bağlı · JIT ${effectiveJit ? "açık" : "kapalı"} · sağlayıcı MFA ${effectiveProviderMfa ? "zorunlu" : "opsiyonel"}`) : c(locale, "Legacy environment binding is active; no governed ACTIVE provider adopted yet.", "Eski ortam değişkeni bağlantısı aktif; henüz yönetişimli ACTIVE sağlayıcı benimsenmedi.")}</small></span><State ok={identityRuntimeHealthy} label={identityRuntimeHealthy ? c(locale, managedOidc ? "Governed" : "Ready", managedOidc ? "Yönetişimli" : "Hazır") : c(locale, "Attention", "Dikkat")}/></div>
          <div><CloudCog size={17}/><span><strong>{c(locale, "Private object storage", "Özel nesne depolama")}</strong><small>{c(locale, "Endpoint, bucket and credentials are checked without exposing their values.", "Endpoint, bucket ve kimlik bilgileri değerleri gösterilmeden kontrol edilir.")}</small></span><State ok={storageConfigured} label={storageConfigured ? c(locale, "Ready", "Hazır") : c(locale, "Missing", "Eksik")}/></div>
          <div><Activity size={17}/><span><strong>{c(locale, "Document malware scan", "Doküman zararlı yazılım taraması")}</strong><small>{c(locale, `${quarantineCount} versions currently require scan/quarantine attention.`, `${quarantineCount} sürüm tarama/karantina aksiyonu gerektiriyor.`)}</small></span><State ok={scanConfigured} label={scanConfigured ? c(locale, "Configured", "Yapılandırıldı") : c(locale, "Missing", "Eksik")}/></div>
          <div><Database size={17}/><span><strong>{c(locale, "Scheduled maintenance", "Zamanlanmış bakım")}</strong><small>{c(locale, "SLA escalation, workflow reminders, notification dispatch and retention.", "SLA eskalasyonu, iş akışı hatırlatmaları, bildirim dağıtımı ve retention.")}</small></span><State ok={maintenanceConfigured} label={maintenanceConfigured ? c(locale, "Protected", "Korumalı") : c(locale, "Token missing", "Token eksik")}/></div>
          <div><KeyRound size={17}/><span><strong>{c(locale, "Local authentication", "Yerel kimlik doğrulama")}</strong><small>{c(locale, `${localAccountCount} active local accounts with password material; runtime gate is ${localAuthRuntimeEnabled ? "enabled" : "disabled"}.`, `Parolası bulunan ${localAccountCount} etkin yerel hesap var; runtime geçidi ${localAuthRuntimeEnabled ? "etkin" : "kapalı"}.`)}</small></span><State ok={localAuthRuntimeEnabled && localAccountCount > 0} label={localAuthRuntimeEnabled ? c(locale, "Enabled", "Etkin") : c(locale, "Runtime disabled", "Runtime kapalı")}/></div>
          <div><BellRing size={17}/><span><strong>{c(locale, "SMTP email delivery", "SMTP e-posta teslimatı")}</strong><small>{smtp.enabled ? c(locale, `${smtp.events.length} event type(s) configured for email mirroring; provider secrets remain hidden.`, `E-posta yansıtması için ${smtp.events.length} olay türü yapılandırılmış; sağlayıcı secret değerleri gizli kalır.`) : c(locale, "Optional external email delivery is disabled; in-app notifications remain active.", "Opsiyonel harici e-posta teslimatı kapalı; uygulama içi bildirimler aktif kalır.")}</small>{canWrite ? <SmtpTestAction enabled={smtp.enabled && smtp.configured}/> : null}</span><State ok={!smtp.enabled || smtp.configured} label={!smtp.enabled ? c(locale, "Disabled", "Kapalı") : smtp.configured ? c(locale, "Ready", "Hazır") : c(locale, "Attention", "Dikkat")}/></div>
          <div><UsersRound size={17}/><span><strong>{c(locale, "SCIM 2.0 provisioning", "SCIM 2.0 provisioning")}</strong><small>{!scim.enabled ? c(locale, "Enterprise user and group provisioning is disabled.", "Enterprise kullanıcı ve grup provisioning kapalı.") : scim.configured ? c(locale, `${scimActiveCount} active / ${scimManagedCount} managed identities · ${scimGroupCount} groups / ${scimMembershipCount} memberships · last user ${fmt(locale, scimLastProvisioning?.provisioningUpdatedAt)} · last group ${fmt(locale, scimLastGroupChange?.updatedAt)}`, `${scimActiveCount} aktif / ${scimManagedCount} yönetilen kimlik · ${scimGroupCount} grup / ${scimMembershipCount} üyelik · son kullanıcı ${fmt(locale, scimLastProvisioning?.provisioningUpdatedAt)} · son grup ${fmt(locale, scimLastGroupChange?.updatedAt)}`) : c(locale, "SCIM is enabled but its tenant/domain/token configuration is incomplete.", "SCIM etkin fakat tenant/domain/token yapılandırması eksik.")}{scim.allowUnmanagedAdoption ? c(locale, " · unmanaged adoption is enabled", " · unmanaged adoption etkin") : ""}{scim.rotationOverlapActive ? c(locale, " · previous-token overlap is active", " · eski token geçiş penceresi aktif") : ""}</small></span><State ok={!scim.enabled || (scim.configured && !scim.allowUnmanagedAdoption && !scim.rotationOverlapActive)} label={!scim.enabled ? c(locale, "Disabled", "Kapalı") : !scim.configured ? c(locale, "Attention", "Dikkat") : scim.allowUnmanagedAdoption || scim.rotationOverlapActive ? c(locale, "Review", "Kontrol et") : c(locale, "Ready", "Hazır")}/></div>
          <div><Link2 size={17}/><span><strong>{c(locale, "Integration live validation", "Entegrasyon canlı doğrulama")}</strong><small>{integrationProbeConfigured ? c(locale, `${integrationProbeOrigins.length} approved origin(s); ${integrationProbeAllowHttp ? "HTTP is explicitly allowed" : "HTTPS only"}; credentials are never sent by the probe.`, `${integrationProbeOrigins.length} onaylı origin; ${integrationProbeAllowHttp ? "HTTP açıkça izinli" : "yalnızca HTTPS"}; probe kimlik bilgisi göndermez.`) : c(locale, "No approved probe origins are configured; draft system integrations cannot complete live validation.", "Onaylı probe origin yapılandırılmamış; taslak sistem entegrasyonları canlı doğrulamayı tamamlayamaz.")}</small></span><State ok={integrationProbeConfigured && !integrationProbeAllowHttp} label={!integrationProbeConfigured ? c(locale, "Not configured", "Yapılandırılmadı") : integrationProbeAllowHttp ? c(locale, "Review HTTP", "HTTP'yi kontrol et") : c(locale, "Ready", "Hazır")}/></div>
        </div>
      </div>

      <aside className="card settings-live-panel settings-security-policy">
        <div className="settings-live-panel-head"><div><span className="section-kicker">{c(locale, "Tenant security", "Tenant güvenliği")}</span><h3>{c(locale, "Enforced posture", "Uygulanan duruş")}</h3></div><LockKeyhole size={18}/></div>
        <dl>
          <div><dt>MFA</dt><dd>{Boolean(security?.assuranceEnforcedAt && security.mfaRequired) ? c(locale, "Required", "Zorunlu") : c(locale, "Not enforced", "Zorunlu değil")}</dd></div>
          <div><dt>{c(locale, "Session maximum", "Maksimum oturum")}</dt><dd>{security?.sessionMaxMinutes ?? 480} min</dd></div>
          <div><dt>{c(locale, "Restricted export", "Kısıtlı dışa aktarma")}</dt><dd>{security?.exportRestrictedData ? c(locale, "Allowed", "İzinli") : c(locale, "Blocked", "Engelli")}</dd></div>
          <div><dt>{c(locale, "Watermarking", "Filigran")}</dt><dd>{security?.downloadWatermarking !== false ? c(locale, "Enabled", "Etkin") : c(locale, "Disabled", "Devre dışı")}</dd></div>
          <div><dt>{c(locale, "Device trust", "Cihaz güveni")}</dt><dd>{Boolean(security?.assuranceEnforcedAt && security.deviceTrustRequired) ? c(locale, "Required", "Zorunlu") : c(locale, "Not enforced", "Zorunlu değil")}</dd></div>
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
        {oidc ? <p className="settings-live-footnote">{c(locale, "Runtime OIDC", "Runtime OIDC")}: {oidc.issuer} · {managedOidc ? c(locale, `governed by ${managedOidc.name}`, `${managedOidc.name} tarafından yönetiliyor`) : c(locale, "legacy environment policy", "eski ortam politikası")} · JIT {effectiveJit ? "on" : "off"} · {oidc.allowedEmailDomains.length} {c(locale, "allowed domains", "izinli domain")} · {c(locale, "provider MFA", "sağlayıcı MFA")} {effectiveProviderMfa ? c(locale, "required", "zorunlu") : c(locale, "optional", "opsiyonel")}</p> : null}
      </div>

      <div className="card settings-live-panel">
        <div className="settings-live-panel-head"><div><span className="section-kicker">{c(locale, "Connected systems", "Bağlı sistemler")}</span><h3>{c(locale, "Live integration registry", "Canlı entegrasyon kaydı")}</h3></div><Link2 size={18}/></div>
        <div className="settings-live-table-wrap"><table className="settings-live-table"><thead><tr><th>{c(locale, "Connection", "Bağlantı")}</th><th>{c(locale, "System", "Sistem")}</th><th>{c(locale, "Auth", "Kimlik")}</th><th>{c(locale, "Enabled", "Etkin")}</th><th>{c(locale, "Last sync", "Son senkron")}</th><th>{c(locale, "Status", "Durum")}</th></tr></thead><tbody>
          {integrations.length ? integrations.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.systemType}</td><td>{row.authType}</td><td>{row.enabled ? c(locale, "Yes", "Evet") : c(locale, "No", "Hayır")}</td><td>{fmt(locale, row.lastSyncAt)}</td><td><State ok={row.status === "ACTIVE" && row.enabled} label={row.status}/></td></tr>) : <tr><td colSpan={6} className="settings-live-empty">{c(locale, "No integration connections registered for this tenant.", "Bu tenant için kayıtlı entegrasyon bağlantısı yok.")}</td></tr>}
        </tbody></table></div>
      </div>
    </section>

    <NotificationOperationsConsole canWrite={canWrite}/>

    <section className="card settings-live-panel settings-notification-ops">
      <div className="settings-live-panel-head"><div><span className="section-kicker">{c(locale, "Notification operations", "Bildirim operasyonları")}</span><h3>{c(locale, "Durable outbox health", "Dayanıklı outbox sağlığı")}</h3></div><BellRing size={18}/></div>
      <div className="settings-notification-counts">
        {["PENDING", "PROCESSING", "FAILED", "DEAD_LETTER", "DELIVERED"].map((status) => <div key={status}><small>{status.replaceAll("_", " ")}</small><strong>{notificationCounts[status] ?? 0}</strong></div>)}
      </div>
      {canWrite ? <NotificationDeadLetterAction count={deadLetters}/> : <p className="settings-live-footnote">{c(locale, "Read-only settings access: dead-letter retry requires settings:write.", "Salt-okunur ayar erişimi: dead-letter yeniden deneme settings:write gerektirir.")}</p>}
    </section>


    <section className="card settings-live-panel settings-local-auth-observability">
      <div className="settings-live-panel-head"><div><span className="section-kicker">{c(locale, "Local authentication telemetry", "Yerel kimlik doğrulama telemetrisi")}</span><h3>{c(locale, "Recent local sign-in activity", "Son yerel giriş aktivitesi")}</h3><p>{c(locale, "Bounded authentication evidence from the append-only audit ledger. Passwords and hashes are never included.", "Değiştirilemez denetim zincirinden sınırlı kimlik doğrulama kanıtı. Parolalar ve hash değerleri hiçbir zaman gösterilmez.")}</p></div><KeyRound size={18}/></div>
      <div className="settings-notification-counts settings-local-auth-counts">
        <div><small>{c(locale, "SUCCESS · 24H", "BAŞARILI · 24S")}</small><strong>{localAuthSuccess24h}</strong></div>
        <div><small>{c(locale, "FAILED · 24H", "HATALI · 24S")}</small><strong>{localAuthFailure24h}</strong></div>
        <div><small>{c(locale, "LOCKED · 24H", "KİLİTLİ · 24S")}</small><strong>{localAuthLocked24h}</strong></div>
        <div><small>{c(locale, "EVENTS SHOWN", "GÖSTERİLEN OLAY")}</small><strong>{localAuthEvents.length}</strong></div>
      </div>
      <div className="settings-live-table-wrap"><table className="settings-live-table"><thead><tr><th>{c(locale, "Account", "Hesap")}</th><th>{c(locale, "Event", "Olay")}</th><th>{c(locale, "Purpose", "Amaç")}</th><th>{c(locale, "Occurred", "Zaman")}</th></tr></thead><tbody>
        {localAuthEvents.length ? localAuthEvents.map((event) => <tr key={event.id}><td><strong>{localAuthAccountNames.get(event.resourceId) ?? c(locale, "Local account", "Yerel hesap")}</strong></td><td><State ok={event.action === "auth.local-succeeded"} label={event.action.replace("auth.local-", "").toUpperCase()}/></td><td>{event.purpose ?? "—"}</td><td>{fmt(locale, event.occurredAt)}</td></tr>) : <tr><td colSpan={4} className="settings-live-empty">{c(locale, "No local authentication events have been recorded yet.", "Henüz yerel kimlik doğrulama olayı kaydedilmedi.")}</td></tr>}
      </tbody></table></div>
      <p className="settings-live-footnote">{c(locale, "Only the latest 50 tenant-scoped local authentication events are shown here; the full immutable history remains available in Audit.", "Burada yalnızca tenant kapsamındaki son 50 yerel kimlik doğrulama olayı gösterilir; tam değiştirilemez geçmiş Audit alanında kalır.")}</p>
    </section>

    {canWrite ? <><SessionRevocationAdmin/><LocalAccountAdmin/><ScimRoleMappingAdmin/><AccessScopeAdmin/>
      <EmergencyAccessAdmin/><JurisdictionAdmin/></> : null}
  </div>;
}
