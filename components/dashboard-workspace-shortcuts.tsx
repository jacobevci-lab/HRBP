import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { can } from "@/lib/authorization";
import { navigation } from "@/lib/navigation";
import { roleWorkspacePreferences } from "@/lib/ui-shell-navigation.mjs";
import type { Locale } from "@/lib/i18n";
import type { RequestContext } from "@/lib/request-context";

const flatNavigation = navigation.flatMap((group) => group.items);

function copy(locale: Locale, role?: string | null) {
  const tr = locale === "tr";
  if (role === "EMPLOYEE") return {
    eyebrow: tr ? "Kişisel çalışma alanı" : "Personal workspace",
    title: tr ? "Bugünkü işlerin" : "Your day",
    detail: tr ? "İzin, bordro, doküman, performans ve gelişim işlerine doğrudan ulaş." : "Jump straight into leave, pay, documents, performance and development work."
  };
  if (role === "MANAGER") return {
    eyebrow: tr ? "Yönetici çalışma alanı" : "Manager workspace",
    title: tr ? "Ekibin ve kararların" : "Your team and decisions",
    detail: tr ? "Bekleyen kararlar, ekip kayıtları, performans ve işe alım işlerini tek başlangıçtan yönet." : "Start with pending decisions, team records, performance and hiring."
  };
  if (role === "HRBP") return {
    eyebrow: "HRBP",
    title: tr ? "İş gücü çalışma alanın" : "Your workforce workspace",
    detail: tr ? "Çalışan, organizasyon, işe alım, yetenek ve iş gücü planlamaya hızlı eriş." : "Move quickly across people, organization, hiring, talent and workforce planning."
  };
  if (role === "HR_OPERATIONS") return {
    eyebrow: tr ? "İK operasyonları" : "HR operations",
    title: tr ? "Operasyon kontrol alanı" : "Operations control",
    detail: tr ? "Yaşam döngüsü, hizmet talepleri, doküman ve aksiyon kuyruklarını öncele." : "Prioritize lifecycle, service, document and action queues."
  };
  if (role === "TENANT_ADMIN") return {
    eyebrow: tr ? "Platform yönetimi" : "Platform administration",
    title: tr ? "Yönetim çalışma alanı" : "Administration workspace",
    detail: tr ? "Kimlik, ayarlar, denetim ve platform yönetişimine hızlı eriş." : "Reach identity, settings, audit and platform governance quickly."
  };
  return {
    eyebrow: tr ? "Hızlı erişim" : "Quick access",
    title: tr ? "Sık kullandığın çalışma alanları" : "Your frequent workspaces",
    detail: tr ? "Rol ve yetkilerine göre önceliklendirilmiş modüller." : "Workspaces prioritized for your role and capabilities."
  };
}

export function DashboardWorkspaceShortcuts({ ctx, locale }: { ctx: RequestContext | null; locale: Locale }) {
  if (!ctx) return null;
  const preferences = roleWorkspacePreferences(ctx.role);
  const items = preferences
    .map((slug) => flatNavigation.find((item) => item.slug === slug))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => !item.requiredCapability || can(ctx, item.requiredCapability))
    .slice(0, 6);

  if (!items.length) return null;
  const text = copy(locale, ctx.role);

  return <section className="workspace-shortcuts">
    <div className="workspace-shortcuts-copy">
      <span className="section-kicker">{text.eyebrow}</span>
      <h2>{text.title}</h2>
      <p>{text.detail}</p>
    </div>
    <div className="workspace-shortcuts-grid">
      {items.map((item) => {
        const Icon = item.icon;
        const href = item.slug === "dashboard" ? "/" : `/module/${item.slug}`;
        return <Link key={item.slug} href={href} className="workspace-shortcut">
          <span className="workspace-shortcut-icon"><Icon size={17} strokeWidth={1.8}/></span>
          <span><strong>{locale === "tr" ? trLabel(item.slug) : enLabel(item.slug)}</strong><small>{locale === "tr" ? "Çalışma alanını aç" : "Open workspace"}</small></span>
          <ArrowUpRight size={14}/>
        </Link>;
      })}
    </div>
  </section>;
}

function enLabel(slug: string) {
  const labels: Record<string,string> = {
    workflows:"My Work", people:"People", organization:"Organization", leave:"Leave", payroll:"Payroll",
    documents:"Documents", performance:"Performance", learning:"Skills & Learning", recruiting:"Recruiting",
    analytics:"People Analytics", talent:"Talent", "workforce-planning":"Workforce Planning", onboarding:"Onboarding",
    offboarding:"Offboarding", "hr-service":"HR Service", positions:"Positions", "time-attendance":"Time & Attendance",
    policies:"Policies", compensation:"Compensation", succession:"Succession", audit:"Audit", settings:"Settings",
    privacy:"Privacy & Compliance", "employee-relations":"Employee Relations"
  };
  return labels[slug] ?? slug;
}

function trLabel(slug: string) {
  const labels: Record<string,string> = {
    workflows:"İşlerim", people:"Çalışanlar", organization:"Organizasyon", leave:"İzin", payroll:"Bordro",
    documents:"Dokümanlar", performance:"Performans", learning:"Yetkinlik & Eğitim", recruiting:"İşe Alım",
    analytics:"İnsan Analitiği", talent:"Yetenek", "workforce-planning":"İş Gücü Planlama", onboarding:"İşe Başlatma",
    offboarding:"İşten Ayrılış", "hr-service":"İK Hizmetleri", positions:"Pozisyonlar", "time-attendance":"Zaman & Devam",
    policies:"Politikalar", compensation:"Ücretlendirme", succession:"Yedekleme", audit:"Denetim", settings:"Ayarlar",
    privacy:"Gizlilik & Uyum", "employee-relations":"Çalışan İlişkileri"
  };
  return labels[slug] ?? slug;
}
