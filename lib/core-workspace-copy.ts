import type { Locale } from "@/lib/i18n";

export type CoreWorkspaceSlug = "people" | "organization" | "positions" | "employee-360";

const copy = {
  people: {
    en: { title: "People", description: "The employee golden record: identity, employment, position, organization and lifecycle history in one governed workspace." },
    tr: { title: "Çalışanlar", description: "Kimlik, istihdam, pozisyon, organizasyon ve yaşam döngüsü geçmişini tek kontrollü çalışma alanında yönetin." }
  },
  organization: {
    en: { title: "Organization", description: "Model legal entities, business units, departments, teams, cost centers and effective-dated hierarchy changes." },
    tr: { title: "Organizasyon", description: "Tüzel kişileri, iş birimlerini, departmanları, ekipleri, maliyet merkezlerini ve geçerlilik tarihli hiyerarşi değişikliklerini yönetin." }
  },
  positions: {
    en: { title: "Positions", description: "Manage budgeted seats independently from incumbents, with status, grade, location, criticality and history." },
    tr: { title: "Pozisyonlar", description: "Bütçelenmiş kadroları çalışanlardan bağımsız olarak durum, seviye, lokasyon, kritiklik ve geçmiş bilgileriyle yönetin." }
  },
  "employee-360": {
    en: { title: "Employee 360", description: "A policy-aware view of the complete employee relationship without collapsing restricted security boundaries." },
    tr: { title: "Çalışan 360", description: "Kısıtlı veri erişim sınırlarını koruyarak çalışan kaydını ve ilişkili süreçleri birlikte görüntüleyin." }
  }
} satisfies Record<CoreWorkspaceSlug, Record<Locale, { title: string; description: string }>>;

export function coreWorkspaceCopy(slug: CoreWorkspaceSlug, locale: Locale) {
  return copy[slug][locale];
}
