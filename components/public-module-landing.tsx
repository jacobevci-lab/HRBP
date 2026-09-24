import { ShieldCheck } from "lucide-react";
import { CoreHRWorkspace } from "@/components/core-hr-workspace";
import { EmployeeServicesWorkspace } from "@/components/employee-services-workspace";
import { GovernancePlanningWorkspace } from "@/components/governance-planning-workspace";
import { GrowthWorkspace } from "@/components/growth-workspace";
import { OffboardingWorkspace } from "@/components/offboarding-workspace";
import { RecruitingWorkspace } from "@/components/recruiting-workspace";
import { WorkPayWorkspace } from "@/components/work-pay-workspace";
import { getServerLocale } from "@/lib/i18n-server";
import { navigation } from "@/lib/navigation";
import { translate, type Locale } from "@/lib/i18n";

const descriptionsEn: Record<string, string> = {
  onboarding: "Preview the controlled transition from accepted offer to ready employee across HR, IT and the hiring manager.",
  "employee-relations": "Preview highly restricted investigation workflows without exposing live case identities or evidence.",
  "hr-service": "Preview employee service queues, SLA signals and request routing with synthetic records.",
  documents: "Preview the governed HR document vault, classification and retention model with synthetic records.",
  policies: "Preview policy lifecycle, acknowledgement and exception governance with synthetic records.",
  workflows: "Preview event-driven HR orchestration, approvals, tasks and SLA controls without executing live actions.",
  audit: "Preview immutable audit-ledger concepts and security-relevant events with synthetic records.",
  settings: "Preview tenant identity, integration and security administration without exposing secrets or live configuration."
};

const descriptionsTr: Record<string, string> = {
  onboarding: "Kabul edilen tekliften hazır çalışana geçişi İK, IT ve işe alım yöneticisi arasında örnek staging verisiyle inceleyin.",
  "employee-relations": "Canlı vaka kimliklerini veya kanıtları açığa çıkarmadan yüksek kısıtlı soruşturma süreçlerini örnek verilerle inceleyin.",
  "hr-service": "Çalışan hizmet kuyruklarını, SLA sinyallerini ve talep yönlendirmeyi sentetik kayıtlarla inceleyin.",
  documents: "Yönetişimli İK doküman kasasını, sınıflandırma ve saklama modelini sentetik kayıtlarla inceleyin.",
  policies: "Politika yaşam döngüsünü, okundu/onay kanıtını ve istisna yönetişimini sentetik kayıtlarla inceleyin.",
  workflows: "Canlı işlem çalıştırmadan olay güdümlü İK orkestrasyonu, onay, görev ve SLA kontrollerini inceleyin.",
  audit: "Değiştirilemez denetim defteri yaklaşımını ve güvenlik açısından önemli olayları sentetik kayıtlarla inceleyin.",
  settings: "Sırları veya canlı yapılandırmayı açığa çıkarmadan tenant kimliği, entegrasyon ve güvenlik yönetimini inceleyin."
};

function titleFor(locale: Locale, slug: string) {
  const item = navigation.flatMap((group) => group.items).find((entry) => entry.slug === slug);
  return item ? translate(locale, item.labelKey) : slug.split("-").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function PublicSettingsPreview({ locale }: { locale: Locale }) {
  const tr = locale === "tr";
  const rows = tr
    ? [["Demo Entra ID", "SSO + SCIM", "MFA zorunlu", "Aktif"], ["Demo Okta", "SSO", "MFA zorunlu", "İncelemede"], ["Demo ERP", "Webhook / API", "Secret ref", "Sağlıklı"]]
    : [["Demo Entra ID", "SSO + SCIM", "MFA required", "Active"], ["Demo Okta", "SSO", "MFA required", "Review"], ["Demo ERP", "Webhook / API", "Secret ref", "Healthy"]];

  return <div className="platform-shell">
    <section className="platform-metrics">
      <div className="platform-metric card"><div className="platform-metric-icon"><ShieldCheck size={18}/></div><div><span>{tr ? "Kimlik sağlayıcıları" : "Identity providers"}</span><strong>2</strong><small>{tr ? "Sentetik konfigürasyon" : "Synthetic configuration"}</small></div></div>
      <div className="platform-metric card"><div className="platform-metric-icon"><ShieldCheck size={18}/></div><div><span>{tr ? "Entegrasyonlar" : "Integrations"}</span><strong>3</strong><small>{tr ? "Secret değerleri gösterilmez" : "Secret values are never shown"}</small></div></div>
      <div className="platform-metric card"><div className="platform-metric-icon"><ShieldCheck size={18}/></div><div><span>MFA</span><strong>100%</strong><small>{tr ? "Ayrıcalıklı erişimde zorunlu" : "Required for privileged access"}</small></div></div>
      <div className="platform-metric card"><div className="platform-metric-icon"><ShieldCheck size={18}/></div><div><span>{tr ? "Veri bölgesi" : "Data region"}</span><strong>EU</strong><small>{tr ? "Örnek tenant politikası" : "Sample tenant policy"}</small></div></div>
    </section>
    <section className="card platform-panel"><div className="platform-head"><div><span className="section-kicker">{tr ? "Salt-okunur yapılandırma kataloğu" : "Read-only configuration catalog"}</span><h3>{tr ? "Kimlik ve entegrasyon önizlemesi" : "Identity and integration preview"}</h3></div><ShieldCheck size={18}/></div><div className="platform-table-wrap"><table className="platform-table compact"><thead><tr><th>{tr ? "Bağlantı" : "Connection"}</th><th>{tr ? "Tür" : "Type"}</th><th>{tr ? "Kontrol" : "Control"}</th><th>{tr ? "Durum" : "Status"}</th></tr></thead><tbody>{rows.map((row)=><tr key={row[0]}>{row.map((value)=><td key={value}>{value}</td>)}</tr>)}</tbody></table></div></section>
  </div>;
}

async function PublicWorkspace({ slug, locale }: { slug: string; locale: Locale }) {
  if (["people", "organization", "positions", "employee-360", "documents", "audit"].includes(slug)) return <CoreHRWorkspace slug={slug}/>;
  if (["recruiting", "onboarding"].includes(slug)) return <RecruitingWorkspace slug={slug}/>;
  if (slug === "offboarding") return <OffboardingWorkspace/>;
  if (["time-attendance", "leave", "compensation", "payroll"].includes(slug)) return <WorkPayWorkspace slug={slug}/>;
  if (["benefits", "performance", "talent", "succession", "learning"].includes(slug)) return <GrowthWorkspace slug={slug}/>;
  if (["employee-relations", "hr-service", "policies", "workflows"].includes(slug)) return <EmployeeServicesWorkspace slug={slug}/>;
  if (["engagement", "workforce-planning", "analytics", "ai-assistant", "privacy"].includes(slug)) return <GovernancePlanningWorkspace slug={slug}/>;
  if (slug === "settings") return <PublicSettingsPreview locale={locale}/>;
  return null;
}

export async function PublicModuleLanding({ slug }: { slug: string }) {
  const locale = await getServerLocale();
  const title = titleFor(locale, slug);
  const tr = locale === "tr";
  const description = (tr ? descriptionsTr : descriptionsEn)[slug] ?? (tr
    ? `${title} modülünün güvenli, salt-okunur staging önizlemesi.`
    : `Safe, read-only staging preview for the ${title} module.`);
  const content = await PublicWorkspace({ slug, locale });

  return <>
    <section className="page-heading module-heading">
      <div><div className="eyebrow">HRBP One / {title}</div><h1>{title}</h1><p>{description}</p></div>
      <div className="module-heading-actions"><button className="secondary-button" disabled><ShieldCheck size={16}/> {tr ? "Salt-okunur staging" : "Read-only staging"}</button></div>
    </section>
    <section className="card module-degraded-banner" style={{ marginBottom: 14, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
      <ShieldCheck size={18} style={{ flex: "0 0 auto", marginTop: 1 }}/>
      <div><strong style={{ display: "block", fontSize: 11 }}>{tr ? "Canlı tenant verisi ve değişiklik işlemleri kapalı" : "Live tenant data and mutations are disabled"}</strong><p style={{ margin: "3px 0 0", fontSize: 9.5, lineHeight: 1.5 }}>{tr ? "Bu görünüm yalnızca sentetik demo kayıtlarını kullanır. Kimlik doğrulanmadan canlı kayıtlar sorgulanmaz; onay, oluşturma, güncelleme, silme ve yönetim işlemleri çalıştırılmaz." : "This view uses synthetic demo records only. Live records are not queried without authentication, and approval, create, update, delete or administration actions are not executed."}</p></div>
    </section>
    {content ?? <section className="card module-table"><div className="empty-state"><ShieldCheck size={24}/><h3>{tr ? "Güvenli staging yüzeyi" : "Safe staging surface"}</h3><p>{tr ? "Bu modül için canlı veri ve ayrıcalıklı işlemler giriş yapılana kadar kapalıdır." : "Live data and privileged actions for this module remain unavailable until sign-in."}</p></div></section>}
  </>;
}
