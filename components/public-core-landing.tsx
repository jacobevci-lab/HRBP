import { CircleAlert } from "lucide-react";
import { CoreHRWorkspace } from "@/components/core-hr-workspace";
import { getServerLocale } from "@/lib/i18n-server";
import { navigation } from "@/lib/navigation";
import { translate } from "@/lib/i18n";

const descriptions = {
  en: {
    people: "Synthetic employee records are available for safe public staging. Sign in to access tenant-scoped live people data.",
    organization: "Synthetic organization structure is available for safe public staging. Live hierarchy requires an authenticated tenant session.",
    positions: "Synthetic position records are available for safe public staging. Live incumbent data remains behind authenticated access.",
    "employee-360": "Synthetic Employee 360 data is shown publicly. Live employee records require authentication and relationship-aware authorization."
  },
  tr: {
    people: "Güvenli herkese açık staging için sentetik çalışan kayıtları gösteriliyor. Tenant kapsamlı canlı çalışan verisi için giriş yapın.",
    organization: "Güvenli herkese açık staging için sentetik organizasyon yapısı gösteriliyor. Canlı hiyerarşi kimliği doğrulanmış tenant oturumu gerektirir.",
    positions: "Güvenli herkese açık staging için sentetik pozisyon kayıtları gösteriliyor. Canlı çalışan atama verisi kimlik doğrulama arkasında kalır.",
    "employee-360": "Herkese açık görünümde sentetik Çalışan 360 verisi gösterilir. Canlı çalışan kayıtları kimlik doğrulama ve ilişki bazlı yetkilendirme gerektirir."
  }
} as const;

export async function PublicCoreLanding({ slug }: { slug: "people" | "organization" | "positions" | "employee-360" }) {
  const locale = await getServerLocale();
  const item = navigation.flatMap((group) => group.items).find((entry) => entry.slug === slug);
  const title = item ? translate(locale, item.labelKey) : slug;
  const copy = descriptions[locale][slug];

  return <>
    <section className="page-heading module-heading">
      <div><div className="eyebrow">HRBP One / {title}</div><h1>{title}</h1><p>{copy}</p></div>
      <button className="secondary-button" disabled><CircleAlert size={16}/> {locale === "tr" ? "Sentetik staging" : "Synthetic staging"}</button>
    </section>
    <section className="card module-degraded-banner" style={{ marginBottom: 14, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
      <CircleAlert size={18} style={{ flex: "0 0 auto", marginTop: 1, color: "var(--orange)" }}/>
      <div><strong style={{ display: "block", fontSize: 11 }}>{locale === "tr" ? "Canlı tenant verisi public yüzeyde kapalı" : "Live tenant data is disabled on the public surface"}</strong><p style={{ margin: "3px 0 0", fontSize: 9.5, lineHeight: 1.5 }}>{locale === "tr" ? "Bu görünüm yalnızca sentetik demo kayıtlarını kullanır. İmzalı oturum olmadan canlı çalışan, atama veya organizasyon verisi sorgulanmaz." : "This view uses synthetic demo records only. Live employee, assignment and organization data is never queried without a signed session."}</p></div>
    </section>
    <CoreHRWorkspace slug={slug}/>
  </>;
}
