import Link from "next/link";
import { ArrowRight, BrainCircuit, ClipboardCheck, GraduationCap, ShieldCheck, Target, UsersRound } from "lucide-react";
import type { Locale } from "@/lib/i18n";

type GrowthFocusProps = {
  slug: "performance" | "talent";
  locale: Locale;
  showParticipant: boolean;
  showAdministration: boolean;
  canReadLearning: boolean;
  canReadSuccession: boolean;
};

function c(locale: Locale, en: string, tr: string) {
  return locale === "tr" ? tr : en;
}

export function GrowthWorkspaceFocus({
  slug,
  locale,
  showParticipant,
  showAdministration,
  canReadLearning,
  canReadSuccession
}: GrowthFocusProps) {
  const performance = slug === "performance";
  const cards = performance ? [
    {
      href: "/module/workflows?view=performance",
      icon: ClipboardCheck,
      title: c(locale, "Performance decisions", "Performans kararları"),
      detail: c(locale, "Open review and approval work in My Work.", "Değerlendirme ve onay işlerini İşlerim'de aç.")
    },
    {
      href: "#growth-overview",
      icon: Target,
      title: c(locale, "Cycle & goal health", "Dönem & hedef sağlığı"),
      detail: c(locale, "Completion, at-risk goals and calibration context.", "Tamamlanma, riskli hedef ve kalibrasyon bağlamı.")
    },
    ...(showParticipant ? [{
      href: "#growth-participant-actions",
      icon: UsersRound,
      title: c(locale, "My review actions", "Değerlendirme aksiyonlarım"),
      detail: c(locale, "Self-review, manager review and goal-progress work.", "Öz değerlendirme, yönetici değerlendirmesi ve hedef ilerleme işleri.")
    }] : []),
    ...(showAdministration ? [{
      href: "#growth-governed-admin",
      icon: ShieldCheck,
      title: c(locale, "Governed administration", "Yönetişimli yönetim"),
      detail: c(locale, "Cycle and review administration stays capability controlled.", "Dönem ve değerlendirme yönetimi yetki kontrollü kalır.")
    }] : [])
  ] : [
    {
      href: "#growth-overview",
      icon: BrainCircuit,
      title: c(locale, "Talent matrix", "Yetenek matrisi"),
      detail: c(locale, "Human-reviewed performance × potential; no opaque score.", "İnsan değerlendirmeli performans × potansiyel; opak skor yok.")
    },
    {
      href: "/module/workflows?view=talent",
      icon: ClipboardCheck,
      title: c(locale, "Talent decisions", "Yetenek kararları"),
      detail: c(locale, "Open governed attention and decisions in My Work.", "Yönetişimli dikkat ve kararları İşlerim'de aç.")
    },
    ...(canReadSuccession ? [{
      href: "/module/succession",
      icon: UsersRound,
      title: c(locale, "Succession", "Yedekleme"),
      detail: c(locale, "Connect talent evidence to critical-role continuity.", "Yetenek kanıtını kritik rol sürekliliğine bağla.")
    }] : []),
    ...(canReadLearning ? [{
      href: "/module/learning",
      icon: GraduationCap,
      title: c(locale, "Development & learning", "Gelişim & öğrenme"),
      detail: c(locale, "Turn assessed gaps into governed development actions.", "Değerlendirilen açıkları yönetişimli gelişim aksiyonuna dönüştür.")
    }] : [])
  ];

  return <section className="growth-focus-grid" aria-label={c(locale, "Growth workspace shortcuts", "Gelişim çalışma alanı kısayolları")}>
    {cards.slice(0, 4).map((item) => {
      const Icon = item.icon;
      return <Link key={item.href} href={item.href} className="growth-focus-card">
        <Icon size={17}/>
        <span><strong>{item.title}</strong><small>{item.detail}</small></span>
        <ArrowRight size={14}/>
      </Link>;
    })}
  </section>;
}
