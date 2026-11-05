import Link from "next/link";
import {
  BellRing,
  ChevronRight,
  FileCheck2,
  KeyRound,
  ScrollText,
  Settings,
  ShieldCheck,
  Workflow
} from "lucide-react";
import { can, type Capability } from "@/lib/authorization";
import { getServerLocale } from "@/lib/i18n-server";
import { getServerRequestContext } from "@/lib/server-session";

type AdminArea = {
  key: string;
  capability: Capability;
  writeCapability?: Capability;
  href: string;
  icon: React.ComponentType<{ size?: number }>;
  title: { en: string; tr: string };
  detail: { en: string; tr: string };
  group: "platform" | "governance";
};

const areas: AdminArea[] = [
  {
    key: "platform",
    capability: "settings:read",
    writeCapability: "settings:write",
    href: "/module/settings",
    icon: Settings,
    title: { en: "Platform & security", tr: "Platform & güvenlik" },
    detail: {
      en: "Identity, SCIM, access scope, security policy, sessions, integrations and runtime readiness.",
      tr: "Kimlik, SCIM, erişim kapsamı, güvenlik politikası, oturumlar, entegrasyonlar ve çalışma zamanı hazırlığı."
    },
    group: "platform"
  },
  {
    key: "workflow",
    capability: "workflows:read",
    writeCapability: "workflows:write",
    href: "/module/workflows?mode=admin",
    icon: Workflow,
    title: { en: "Workflow administration", tr: "İş akışı yönetimi" },
    detail: {
      en: "Versioned workflow definitions, lifecycle controls, approvals and operational orchestration.",
      tr: "Sürümlü iş akışı tanımları, yaşam döngüsü kontrolleri, onaylar ve operasyonel orkestrasyon."
    },
    group: "platform"
  },
  {
    key: "notifications",
    capability: "settings:read",
    href: "/module/notifications",
    icon: BellRing,
    title: { en: "Notifications", tr: "Bildirimler" },
    detail: {
      en: "Delivery state, operational notifications and user-visible communication history.",
      tr: "Teslimat durumu, operasyonel bildirimler ve kullanıcıya görünür iletişim geçmişi."
    },
    group: "platform"
  },
  {
    key: "audit",
    capability: "audit:read",
    href: "/module/audit",
    icon: ScrollText,
    title: { en: "Audit & assurance", tr: "Denetim & güvence" },
    detail: {
      en: "Immutable business/security history, verification coverage and assurance evidence.",
      tr: "Değiştirilemez iş/güvenlik geçmişi, doğrulama kapsamı ve güvence kanıtları."
    },
    group: "governance"
  },
  {
    key: "privacy",
    capability: "privacy:read",
    writeCapability: "privacy:write",
    href: "/module/privacy",
    icon: ShieldCheck,
    title: { en: "Privacy & compliance", tr: "Gizlilik & uyum" },
    detail: {
      en: "DSR, privacy assessments, transfers and restricted compliance operations.",
      tr: "DSR, gizlilik değerlendirmeleri, veri transferleri ve kısıtlı uyum operasyonları."
    },
    group: "governance"
  },
  {
    key: "policies",
    capability: "policies:read",
    writeCapability: "policies:write",
    href: "/module/policies",
    icon: FileCheck2,
    title: { en: "Policies", tr: "Politikalar" },
    detail: {
      en: "Policy lifecycle, publication, acknowledgements, exceptions and independent decisions.",
      tr: "Politika yaşam döngüsü, yayın, okundu kanıtı, istisnalar ve bağımsız kararlar."
    },
    group: "governance"
  }
];

function c(locale: "en" | "tr", value: { en: string; tr: string }) {
  return locale === "tr" ? value.tr : value.en;
}

function AreaCard({ area, locale, writable }: { area: AdminArea; locale: "en" | "tr"; writable: boolean }) {
  const Icon = area.icon;
  return <Link className="admin-studio-card" href={area.href} data-admin-area={area.key}>
    <span className="admin-studio-icon"><Icon size={19}/></span>
    <span className="admin-studio-card-copy">
      <strong>{c(locale, area.title)}</strong>
      <small>{c(locale, area.detail)}</small>
      <em>{area.writeCapability
        ? writable
          ? (locale === "tr" ? "Yapılandırma yetkisi" : "Configuration access")
          : (locale === "tr" ? "Salt okunur" : "Read only")
        : (locale === "tr" ? "Görüntüleme" : "View")}</em>
    </span>
    <ChevronRight size={16}/>
  </Link>;
}

export async function AdminStudio() {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx) return <section className="card manager-hub-restricted"><KeyRound size={24}/><div><h3>{locale === "tr" ? "Kimlik doğrulama gerekli" : "Authentication required"}</h3><p>{locale === "tr" ? "Yönetim alanı canlı tenant kontrol düzlemini kullanır." : "Administration uses the live tenant control plane."}</p></div></section>;

  const visible = areas.filter((area) => can(ctx, area.capability));
  if (!visible.length) return <section className="card manager-hub-restricted"><ShieldCheck size={24}/><div><h3>{locale === "tr" ? "Yönetim erişimi yok" : "Administration access is restricted"}</h3><p>{locale === "tr" ? "Rolünüz yönetim veya yönetişim çalışma alanlarından hiçbirini görüntüleme yetkisine sahip değil." : "Your role has no read capability for administration or governance workspaces."}</p></div></section>;

  const platform = visible.filter((area) => area.group === "platform");
  const governance = visible.filter((area) => area.group === "governance");

  return <div className="admin-studio">
    <section className="page-heading module-heading manager-hub-heading">
      <div>
        <div className="eyebrow">HRBP One / {locale === "tr" ? "Yönetim" : "Administration"}</div>
        <h1>{locale === "tr" ? "Admin Studio" : "Admin Studio"}</h1>
        <p>{locale === "tr"
          ? "Kimlik, entegrasyon, iş akışı, güvenlik ve yönetişim işlerini tek başlangıç noktasından açın; her alan kendi yetki ve denetim sınırını korur."
          : "Open identity, integration, workflow, security and governance work from one starting point while each domain keeps its own authorization and audit boundary."}</p>
      </div>
    </section>

    {platform.length ? <section className="admin-studio-section">
      <div className="admin-studio-section-head"><div><span className="section-kicker">{locale === "tr" ? "Kontrol düzlemi" : "Control plane"}</span><h2>{locale === "tr" ? "Platform yönetimi" : "Platform administration"}</h2></div></div>
      <div className="admin-studio-grid">{platform.map((area) => <AreaCard key={area.key} area={area} locale={locale} writable={area.writeCapability ? can(ctx, area.writeCapability) : false}/>)}</div>
    </section> : null}

    {governance.length ? <section className="admin-studio-section">
      <div className="admin-studio-section-head"><div><span className="section-kicker">{locale === "tr" ? "Güvence" : "Assurance"}</span><h2>{locale === "tr" ? "Yönetişim & uyum" : "Governance & compliance"}</h2></div></div>
      <div className="admin-studio-grid">{governance.map((area) => <AreaCard key={area.key} area={area} locale={locale} writable={area.writeCapability ? can(ctx, area.writeCapability) : false}/>)}</div>
    </section> : null}

    <section className="card admin-studio-boundary"><ShieldCheck size={18}/><div><strong>{locale === "tr" ? "Yetkiler burada birleşmez" : "Capabilities do not merge here"}</strong><p>{locale === "tr" ? "Admin Studio yalnız yönlendirme katmanıdır. Örneğin settings:read, settings:write vermez; workflow veya privacy aksiyonları kendi domain kontrollerini yeniden uygular." : "Admin Studio is only a navigation layer. For example, settings:read does not imply settings:write, and workflow/privacy actions re-enforce their own domain controls."}</p></div></section>
  </div>;
}
