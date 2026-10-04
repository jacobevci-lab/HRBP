import Link from "next/link";
import type { ReactNode } from "react";
import { CircleCheckBig, Plus } from "lucide-react";
import { can } from "@/lib/authorization";
import { navigation } from "@/lib/navigation";
import { getServerLocale } from "@/lib/i18n-server";
import { translate, type Locale } from "@/lib/i18n";
import { getServerRequestContext } from "@/lib/server-session";
import { PublicModuleLanding } from "@/components/public-module-landing";

const descriptions: Record<string, { en: string; tr: string }> = {
  people: {
    en: "The employee golden record: identity, employment, position, organization and lifecycle history in one governed workspace.",
    tr: "Çalışanın ana kaydını; kimlik, istihdam, pozisyon, organizasyon ve yaşam döngüsü geçmişiyle tek yönetişimli çalışma alanında yönetin."
  },
  organization: {
    en: "Model legal entities, business units, departments, teams, cost centers and effective-dated hierarchy changes.",
    tr: "Tüzel kişileri, iş birimlerini, departmanları, ekipleri, maliyet merkezlerini ve geçerlilik tarihli hiyerarşi değişikliklerini modelleyin."
  },
  "employee-360": {
    en: "A policy-aware view of the complete employee relationship without collapsing restricted security boundaries.",
    tr: "Kısıtlı güvenlik sınırlarını bozmadan çalışan ilişkisinin tamamını politika farkındalığıyla görüntüleyin."
  },
  positions: {
    en: "Manage budgeted seats independently from incumbents, with status, grade, location, criticality and history.",
    tr: "Bütçelenmiş pozisyonları çalışanlardan bağımsız olarak durum, seviye, lokasyon, kritiklik ve geçmiş bilgileriyle yönetin."
  },
  recruiting: {
    en: "Plan position-backed requisitions, govern candidate data, manage selection and convert accepted offers directly into employee records.",
    tr: "Pozisyona bağlı talepleri planlayın, aday verisini yönetin, seçimi takip edin ve kabul edilen teklifleri doğrudan çalışan kaydına dönüştürün."
  },
  onboarding: {
    en: "Orchestrate the controlled transition from accepted offer to ready employee across HR, IT and the hiring manager.",
    tr: "Kabul edilmiş tekliften hazır çalışana geçişi İK, IT ve işe alım yöneticisi arasında kontrollü şekilde yönetin."
  },
  offboarding: {
    en: "Control resignations, terminations, retirement and contract exits across HR, manager, IT, security, facilities and payroll before employment is closed.",
    tr: "İstihdam kapanmadan önce istifa, fesih, emeklilik ve sözleşme bitişlerini İK, yönetici, IT, güvenlik, tesis ve bordro ile yönetin."
  },
  compensation: {
    en: "Run effective-dated salary changes, review cycles, budget controls and restricted compensation approvals.",
    tr: "Geçerlilik tarihli ücret değişikliklerini, değerlendirme döngülerini, bütçe kontrollerini ve kısıtlı ücret onaylarını yönetin."
  },
  "employee-relations": {
    en: "Run highly restricted investigations from allegation and interview through evidence, findings, corrective action, appeal and closure inside a case wall.",
    tr: "İddia ve görüşmeden kanıt, bulgu, düzeltici aksiyon, itiraz ve kapanışa kadar yüksek kısıtlı soruşturmaları vaka duvarında yönetin."
  },
  "hr-service": {
    en: "Provide a single employee service desk with identity-bound requests, queue routing, SLAs, private HR notes and complete request history.",
    tr: "Kimliğe bağlı talepler, kuyruk yönlendirme, SLA, özel İK notları ve tam işlem geçmişiyle tek çalışan hizmet masası sağlayın."
  },
  policies: {
    en: "Control policy drafting, versions, approvals, publication, acknowledgement evidence, review dates and exceptions in one register.",
    tr: "Politika taslakları, versiyonlar, onaylar, yayın, okundu kanıtı, gözden geçirme tarihleri ve istisnaları tek kayıtta yönetin."
  },
  documents: {
    en: "Operate a private, versioned HR document vault with classification, malware quarantine, legal hold, controlled access and built-in signature evidence.",
    tr: "Sınıflandırma, zararlı yazılım karantinası, legal hold, kontrollü erişim ve imza kanıtıyla özel ve versiyonlu İK doküman kasası işletin."
  },
  audit: {
    en: "Review immutable security-relevant reads and business mutations across the employee lifecycle.",
    tr: "Çalışan yaşam döngüsü boyunca değiştirilemez güvenlik okumalarını ve iş mutasyonlarını inceleyin."
  },
  workflows: {
    en: "Orchestrate event-driven HR processes with versioned definitions, approvals, tasks, SLAs, failure handling and immutable process history.",
    tr: "Versiyonlu tanımlar, onaylar, görevler, SLA, hata yönetimi ve değiştirilemez süreç geçmişiyle olay güdümlü İK süreçlerini yönetin."
  }
};

type WorkspaceProps = { slug: string; query?: string; personId?: string; tab?: string };

/** Only live implementations belong in this authenticated dispatcher.
 * Rendering/import failures propagate intact to Next's route error boundary.
 * Anonymous catalog previews are handled before entering this function. */
async function renderLiveWorkspace({ slug, query = "", personId, tab }: WorkspaceProps): Promise<ReactNode> {
  switch (slug) {
    case "people": case "organization": case "positions": case "employee-360": {
      const { CoreHRLiveWorkspace } = await import("@/components/core-hr-live-workspace");
      return await CoreHRLiveWorkspace({ slug, query, personId, tab });
    }
    case "documents": case "audit": {
      const { GovernanceLiveWorkspace } = await import("@/components/governance-live-workspace");
      return await GovernanceLiveWorkspace({ slug, query });
    }
    case "compensation": {
      const { CompensationLiveWorkspace } = await import("@/components/compensation-live-workspace");
      return await CompensationLiveWorkspace();
    }
    case "employee-relations": case "hr-service": case "policies": case "workflows": {
      const { EmployeeServicesLiveWorkspace } = await import("@/components/employee-services-live-workspace");
      return await EmployeeServicesLiveWorkspace({ slug, focusId: query || undefined, mode: tab });
    }
    case "recruiting": case "onboarding": {
      const { RecruitingWorkspace } = await import("@/components/recruiting-workspace");
      return await RecruitingWorkspace({ slug });
    }
    case "offboarding": {
      const { OffboardingWorkspace } = await import("@/components/offboarding-workspace");
      return await OffboardingWorkspace();
    }
    default:
      // Dedicated work/pay, growth and governance pages own their live routing.
      // An unsupported dispatch is a configuration error, never a demo success.
      throw new Error("Unsupported live workspace dispatch.");
  }
}

export async function ModuleLanding({ slug, query = "", personId, tab }: WorkspaceProps) {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx) return <PublicModuleLanding slug={slug}/>;
  const item = navigation.flatMap(group => group.items).find(entry => entry.slug === slug);
  const title = item ? translate(locale, item.labelKey) : (locale === "tr" ? "Çalışma alanı" : "Workspace");
  const meta = Object.hasOwn(descriptions, slug) ? descriptions[slug][locale as Locale] : "";
  const capability = slug === "workflows" ? "workflows:read" : item?.requiredCapability;
  // Repeat the existing workspace capability at the dispatch boundary. Domain
  // readers still enforce relationship/case-wall scope and mutation authorization.
  if (capability && !can(ctx, capability)) return <section data-module-workspace-state="restricted" data-module-workspace={slug}>
    <section className="page-heading module-heading"><div><h1>{title}</h1><p>{meta}</p></div></section>
    <section className="card module-table"><div className="empty-state"><h3>{locale === "tr" ? "Erişim kısıtlı" : "Access is restricted"}</h3><p>{locale === "tr" ? "Mevcut rolünüz bu çalışma alanının veri erişim yetkisini içermiyor." : "Your current role does not include this workspace's data access capability."}</p></div></section>
  </section>;

  const content = await renderLiveWorkspace({ slug, query, personId, tab });
  if (content === null || content === undefined) throw new Error("Live workspace returned no content.");
  const createHref = slug === "people" && can(ctx, "people:read") && can(ctx, "people:write")
    ? "/module/people/new"
    : slug === "positions" && can(ctx, "positions:read") && can(ctx, "positions:write") ? "/module/positions/new" : null;
  return <section data-module-workspace-state="rendered" data-module-workspace={slug}>
    <section className="page-heading module-heading">
      <div><div className="eyebrow">HRBP One / {title}</div><h1>{title}</h1><p>{meta}</p></div>
      <div className="module-heading-actions">
        <span className="secondary-button"><CircleCheckBig size={16}/>{locale === "tr" ? "Canlı veri görünümü" : "Live data view"}</span>
        {createHref ? <Link className="create-button" href={createHref}><Plus size={17}/>{locale === "tr" ? (slug === "people" ? "Çalışan ekle" : "Yeni pozisyon") : (slug === "people" ? "Add employee" : "New position")}</Link> : null}
      </div>
    </section>
    {content}
  </section>;
}
