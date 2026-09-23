import { CircleAlert, CircleCheckBig, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { can, type Capability } from "@/lib/authorization";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";
import { getServerRequestContext } from "@/lib/server-session";

type GovernanceSlug = "engagement" | "workforce-planning" | "ai-assistant" | "privacy";

const copy: Record<GovernanceSlug, { en: { title: string; description: string }; tr: { title: string; description: string } }> = {
  engagement: {
    en: { title: "Engagement", description: "Run privacy-preserving employee listening with relationship-scoped campaign visibility and anonymity thresholds." },
    tr: { title: "Bağlılık", description: "İlişki kapsamlı kampanya görünürlüğü ve anonimlik eşikleriyle gizliliği koruyan çalışan dinleme süreçlerini yönetin." }
  },
  "workforce-planning": {
    en: { title: "Workforce Planning", description: "Model future FTE, role, skill and cost scenarios within the authorized organization and position scope." },
    tr: { title: "İşgücü Planlama", description: "Gelecek FTE, rol, yetkinlik ve maliyet senaryolarını yetkili organizasyon ve pozisyon kapsamı içinde modelleyin." }
  },
  "ai-assistant": {
    en: { title: "AI Assistant", description: "Provide purpose-bound HR assistance with actor-scoped telemetry, explicit data boundaries and human-owned employment decisions." },
    tr: { title: "AI Asistan", description: "Aktör kapsamlı telemetri, açık veri sınırları ve insan sahipliğinde istihdam kararlarıyla amaç sınırlı İK desteği sağlayın." }
  },
  privacy: {
    en: { title: "Privacy & Compliance", description: "Operate RoPA, data-subject rights, DPIA signals and transfer safeguards inside a dedicated Privacy and Legal boundary." },
    tr: { title: "Gizlilik & Uyum", description: "RoPA, veri sahibi hakları, DPIA sinyalleri ve aktarım kontrollerini özel Privacy ve Legal erişim sınırı içinde yönetin." }
  }
};

function capabilityFor(slug: GovernanceSlug): Capability {
  if (slug === "engagement") return "engagement:read";
  if (slug === "workforce-planning") return "workforce-plan:read";
  if (slug === "ai-assistant") return "ai:use";
  return "privacy:read";
}

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }

export async function GovernancePlanningModulePage({ slug }: { slug: GovernanceSlug }) {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  const meta = copy[slug][locale];
  const capability = capabilityFor(slug);

  if (!ctx || !can(ctx, capability)) {
    return <AppShell>
      <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div></section>
      <section className="card module-table"><div className="empty-state"><ShieldCheck size={24}/><h3>{c(locale, "Access is restricted", "Erişim kısıtlı")}</h3><p>{c(locale, `Your signed role does not include ${capability}.`, `İmzalı rolünüz ${capability} yetkisini içermiyor.`)}</p></div></section>
    </AppShell>;
  }

  try {
    const { GovernancePlanningLiveWorkspace } = await import("@/components/governance-planning-live-workspace");
    const live = await GovernancePlanningLiveWorkspace({ slug });
    const ownedDrafts = slug === "workforce-planning"
      ? await (await import("@/components/workforce-planning-owned-drafts")).WorkforcePlanningOwnedDrafts()
      : null;
    return <AppShell>
      <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="module-heading-actions"><button className="secondary-button" disabled><CircleCheckBig size={16}/> {c(locale, "Governed live data", "Yönetişimli canlı veri")}</button></div></section>
      {live}
      {ownedDrafts}
    </AppShell>;
  } catch (error) {
    console.error(`[HRBP] Dedicated governance-planning ${slug} workspace failed; protected fallback activated.`, error);
    return <AppShell>
      <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="module-heading-actions"><button className="secondary-button" disabled><CircleAlert size={16}/> {c(locale, "Protected fallback", "Korumalı yedek mod")}</button></div></section>
      <section className="card module-table"><div className="empty-state"><CircleAlert size={24}/><h3>{c(locale, `${meta.title} is temporarily unavailable`, `${meta.title} geçici olarak kullanılamıyor`)}</h3><p>{c(locale, "The governed data plane could not initialize. No demo values are substituted and no protected mutation was attempted.", "Yönetişimli veri katmanı başlatılamadı. Yerine demo değer konulmadı ve hiçbir korumalı değişiklik işlemi denenmedi.")}</p></div></section>
    </AppShell>;
  }
}
