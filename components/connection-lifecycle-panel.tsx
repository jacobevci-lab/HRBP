import { KeyRound, Link2, ShieldCheck } from "lucide-react";
import { ConnectionLifecycleActions } from "@/components/connection-lifecycle-actions";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n-server";
import { integrationValidationCurrent } from "@/lib/integration-live-validation.mjs";
import { oidcValidationCurrent } from "@/lib/oidc";
import { isOidcRuntimeProvider } from "@/lib/runtime-identity-provider";
import { getServerRequestContext } from "@/lib/server-session";
import { identityActivationIssues, integrationActivationIssues } from "@/lib/settings-connection-validation";

function c(locale: "en" | "tr", en: string, tr: string) {
  return locale === "tr" ? tr : en;
}

function fmt(locale: "en" | "tr", value: Date | null | undefined) { if (!value) return "—"; return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(value); }

function statusTone(status: string) {
  return status === "ACTIVE" ? "ok" : status === "DEGRADED" ? "danger" : status === "DRAFT" ? "draft" : "muted";
}

export async function ConnectionLifecyclePanel() {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx || !can(ctx, "settings:read")) return null;
  const canWrite = can(ctx, "settings:write");
  const [identities, integrations] = await Promise.all([
    db.identityProviderConnection.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ status: "asc" }, { name: "asc" }], take: 100 }),
    db.integrationConnection.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ status: "asc" }, { name: "asc" }], take: 200 })
  ]);

  return <section className="connection-lifecycle-panel">
    <div className="connection-lifecycle-heading">
      <div><span className="section-kicker">{c(locale, "Governed activation", "Yönetişim kontrollü aktivasyon")}</span><h2>{c(locale, "Connection Lifecycle Control", "Bağlantı Yaşam Döngüsü Kontrolü")}</h2><p>{c(locale, "Draft connections are activated only after required metadata is present, configuration validation is recorded and an administrator provides an explicit attestation. All transitions are tenant-scoped and audited.", "Taslak bağlantılar yalnızca gerekli metadata tamamlandıktan, yapılandırma doğrulaması kaydedildikten ve bir yönetici açık teyit girdikten sonra etkinleştirilir. Tüm geçişler tenant kapsamındadır ve denetlenir.")}</p></div>
      <ShieldCheck size={20}/>
    </div>

    <div className="connection-lifecycle-grid">
      <div className="card connection-lifecycle-card">
        <div className="connection-lifecycle-title"><KeyRound size={17}/><div><strong>{c(locale, "Identity providers", "Kimlik sağlayıcıları")}</strong><small>{c(locale, "Activation readiness and administrative state transitions.", "Aktivasyon hazırlığı ve yönetimsel durum geçişleri.")}</small></div></div>
        <div className="connection-lifecycle-table-wrap"><table className="connection-lifecycle-table"><thead><tr><th>{c(locale, "Provider", "Sağlayıcı")}</th><th>{c(locale, "Type", "Tür")}</th><th>{c(locale, "Readiness", "Hazırlık")}</th><th>{c(locale, "Status", "Durum")}</th>{canWrite ? <th>{c(locale, "Action", "Aksiyon")}</th> : null}</tr></thead><tbody>
          {identities.length ? identities.map((row) => {
            const issues = identityActivationIssues(row);
            const oidcRuntime = isOidcRuntimeProvider(row.type);
            const validationCurrent = oidcRuntime ? oidcValidationCurrent(row.lastValidatedAt) : Boolean(row.lastValidatedAt);
            return <tr key={row.id}><td><strong>{row.name}</strong><small>{row.issuer ?? row.metadataUrl ?? "—"}</small></td><td>{row.type.replaceAll("_", " ")}</td><td>{issues.length ? <span className="connection-readiness attention">{c(locale, `Missing ${issues.join(", ")}`, `Eksik: ${issues.join(", ")}`)}</span> : validationCurrent ? <span className="connection-readiness ready">{oidcRuntime ? c(locale, "Live validated", "Canlı doğrulandı") : c(locale, "Validated", "Doğrulandı")} · {fmt(locale, row.lastValidatedAt)}</span> : row.lastValidatedAt && oidcRuntime ? <span className="connection-readiness attention">{c(locale, "Live validation expired", "Canlı doğrulama süresi doldu")} · {fmt(locale, row.lastValidatedAt)}</span> : <span className="connection-readiness attention">{oidcRuntime ? c(locale, "Live validation required", "Canlı doğrulama gerekli") : c(locale, "Validation required", "Doğrulama gerekli")}</span>}</td><td><span className={`connection-status ${statusTone(row.status)}`}>{row.status}</span></td>{canWrite ? <td><ConnectionLifecycleActions kind="identity" id={row.id} name={row.name} status={row.status} validated={validationCurrent}/></td> : null}</tr>;
          }) : <tr><td colSpan={canWrite ? 5 : 4} className="connection-lifecycle-empty">{c(locale, "No identity provider records.", "Kimlik sağlayıcı kaydı yok.")}</td></tr>}
        </tbody></table></div>
      </div>

      <div className="card connection-lifecycle-card">
        <div className="connection-lifecycle-title"><Link2 size={17}/><div><strong>{c(locale, "System integrations", "Sistem entegrasyonları")}</strong><small>{c(locale, "Activation requires an allowlisted live transport probe; redirects and credentials are never used by validation.", "Aktivasyon için allowlist kontrollü canlı transport doğrulaması gerekir; doğrulama redirect takip etmez ve kimlik bilgisi göndermez.")}</small></div></div>
        <div className="connection-lifecycle-table-wrap"><table className="connection-lifecycle-table"><thead><tr><th>{c(locale, "Connection", "Bağlantı")}</th><th>{c(locale, "System", "Sistem")}</th><th>{c(locale, "Readiness", "Hazırlık")}</th><th>{c(locale, "Status", "Durum")}</th>{canWrite ? <th>{c(locale, "Action", "Aksiyon")}</th> : null}</tr></thead><tbody>
          {integrations.length ? integrations.map((row) => {
            const issues = integrationActivationIssues(row);
            const validationCurrent = integrationValidationCurrent(row.lastValidatedAt);
            return <tr key={row.id}><td><strong>{row.name}</strong><small>{row.baseUrl ?? "—"}</small></td><td>{row.systemType}<small>{row.authType}</small></td><td>{issues.length ? <span className="connection-readiness attention">{c(locale, `Missing ${issues.join(", ")}`, `Eksik: ${issues.join(", ")}`)}</span> : validationCurrent ? <span className="connection-readiness ready">{c(locale, "Live validated", "Canlı doğrulandı")} · {fmt(locale, row.lastValidatedAt)}</span> : row.lastValidatedAt ? <span className="connection-readiness attention">{c(locale, "Validation expired", "Doğrulama süresi doldu")} · {fmt(locale, row.lastValidatedAt)}</span> : <span className="connection-readiness attention">{c(locale, "Live validation required", "Canlı doğrulama gerekli")}</span>}</td><td><span className={`connection-status ${statusTone(row.status)}`}>{row.status}</span></td>{canWrite ? <td><ConnectionLifecycleActions kind="integration" id={row.id} name={row.name} status={row.status} validated={validationCurrent}/></td> : null}</tr>;
          }) : <tr><td colSpan={canWrite ? 5 : 4} className="connection-lifecycle-empty">{c(locale, "No integration records.", "Entegrasyon kaydı yok.")}</td></tr>}
        </tbody></table></div>
      </div>
    </div>
  </section>;
}
