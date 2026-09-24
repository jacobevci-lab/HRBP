import { CircleAlert, CircleCheckBig, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { can, type Capability } from "@/lib/authorization";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";
import { getServerRequestContext } from "@/lib/server-session";

type GrowthSlug = "benefits" | "performance" | "talent" | "succession" | "learning";
type GrowthWriteSlug = Exclude<GrowthSlug, "performance">;

const copy: Record<GrowthSlug, { en: { title: string; description: string }; tr: { title: string; description: string } }> = {
  benefits: {
    en: { title: "Benefits", description: "Administer effective-dated plans and employee coverage without losing payroll or historical traceability." },
    tr: { title: "Yan Haklar", description: "Bordro ve tarihsel izlenebilirliği kaybetmeden tarih-etkin planları ve çalışan kapsamını yönetin." }
  },
  performance: {
    en: { title: "Performance", description: "Run goals, reviews and calibration with human-owned ratings and auditable decision evidence." },
    tr: { title: "Performans", description: "Hedef, değerlendirme ve kalibrasyonu insan sahipliğinde puanlar ve denetlenebilir karar kanıtıyla yönetin." }
  },
  talent: {
    en: { title: "Talent", description: "Review performance and potential using explicit human assessments instead of opaque employee scoring." },
    tr: { title: "Yetenek", description: "Opak çalışan skorları yerine açık insan değerlendirmeleriyle performans ve potansiyeli yönetin." }
  },
  succession: {
    en: { title: "Succession", description: "Protect critical-role continuity with successor readiness, coverage gaps and review ownership." },
    tr: { title: "Yedekleme", description: "Aday hazırlığı, kapsama açıkları ve inceleme sahipliğiyle kritik rol sürekliliğini koruyun." }
  },
  learning: {
    en: { title: "Skills & Learning", description: "Manage learning compliance, critical skills and development signals on the same employment graph." },
    tr: { title: "Yetkinlikler & Öğrenme", description: "Eğitim uyumu, kritik yetkinlikler ve gelişim sinyallerini aynı istihdam grafiğinde yönetin." }
  }
};

function accessFor(slug: GrowthSlug): Capability {
  if (slug === "benefits") return "benefits:read";
  if (slug === "performance") return "performance:read";
  if (slug === "talent") return "talent:read";
  if (slug === "succession") return "succession:read";
  return "learning:read";
}

function writeAccessFor(slug: GrowthSlug): Capability | null {
  if (slug === "benefits") return "benefits:write";
  if (slug === "performance") return "performance:write";
  if (slug === "talent") return "talent:write";
  if (slug === "succession") return "succession:write";
  if (slug === "learning") return "learning:write";
  return null;
}

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }

function ConsoleWarning({ locale, title, body }: { locale: Locale; title: string; body: string }) {
  return <section className="card module-degraded-banner" style={{ marginTop: 14, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}><CircleAlert size={18}/><div><strong style={{ display: "block", fontSize: 11 }}>{title}</strong><p style={{ margin: "3px 0 0", fontSize: 9.5, lineHeight: 1.5 }}>{body}</p></div></section>;
}

export async function GrowthModulePage({ slug }: { slug: GrowthSlug }) {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  const meta = copy[slug][locale];

  if (!ctx) {
    const { GrowthWorkspace } = await import("@/components/growth-workspace");
    return <AppShell>
      <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="module-heading-actions"><button className="secondary-button" disabled><ShieldCheck size={16}/> {c(locale, "Read-only staging preview", "Salt-okunur staging önizlemesi")}</button></div></section>
      <section className="card module-degraded-banner" style={{ marginBottom: 14, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}><ShieldCheck size={18} style={{ flex: "0 0 auto", marginTop: 1 }}/><div><strong style={{ display: "block", fontSize: 11 }}>{c(locale, "Safe demo data", "Güvenli demo verisi")}</strong><p style={{ margin: "3px 0 0", fontSize: 9.5, lineHeight: 1.5 }}>{c(locale, "This public staging view uses sample values only. Protected employee records and mutations remain unavailable until you sign in with an authorized role.", "Bu genel staging görünümü yalnızca örnek değerler kullanır. Korumalı çalışan kayıtları ve değişiklik işlemleri, yetkili bir rolle giriş yapılana kadar kullanılamaz.")}</p></div></section>
      <GrowthWorkspace slug={slug}/>
    </AppShell>;
  }

  if (!can(ctx, accessFor(slug))) {
    return <AppShell>
      <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div></section>
      <section className="card module-table"><div className="empty-state"><ShieldCheck size={24}/><h3>{c(locale, "Access is restricted", "Erişim kısıtlı")}</h3><p>{c(locale, "Your signed role does not include access to this governed growth domain.", "İmzalı rolünüz bu yönetişimli gelişim alanına erişim yetkisi içermiyor.")}</p></div></section>
    </AppShell>;
  }

  try {
    const { GrowthLiveWorkspace } = await import("@/components/growth-live-workspace");
    const liveWorkspace = await GrowthLiveWorkspace({ slug });
    let participant: React.ReactNode = null;
    let operations: React.ReactNode = null;
    let lifecycle: React.ReactNode = null;
    const writeCapability = writeAccessFor(slug);

    if (slug === "performance" && (can(ctx, "performance:self-submit") || can(ctx, "performance:manager-review") || can(ctx, "performance:goal-progress"))) {
      try {
        const [{ PerformanceParticipantConsole }, { getPerformanceParticipantData }] = await Promise.all([
          import("@/components/performance-participant-console"),
          import("@/lib/performance-participant-data")
        ]);
        const participantData = await getPerformanceParticipantData(ctx);
        participant = <PerformanceParticipantConsole {...participantData}/>;
      } catch (participantError) {
        console.error("[HRBP] performance participant inbox could not initialize.", participantError);
        participant = <ConsoleWarning locale={locale} title={c(locale, "Participant review inbox is temporarily unavailable", "Katılımcı değerlendirme kutusu geçici olarak kullanılamıyor")} body={c(locale, "No participant decision was changed. The governed read surface remains available while the inbox recovers.", "Hiçbir katılımcı kararı değiştirilmedi. Kutu toparlanırken yönetişimli salt-okunur görünüm kullanılabilir.")}/>;
      }
    } else if (slug === "learning" && can(ctx, "learning:self-progress")) {
      try {
        const [{ LearningParticipantConsole }, { getLearningParticipantData }] = await Promise.all([
          import("@/components/learning-participant-console"),
          import("@/lib/learning-participant-data")
        ]);
        const assignments = await getLearningParticipantData(ctx);
        participant = <LearningParticipantConsole assignments={assignments}/>;
      } catch (participantError) {
        console.error("[HRBP] learning participant inbox could not initialize.", participantError);
        participant = <ConsoleWarning locale={locale} title={c(locale, "Learning self-service is temporarily unavailable", "Eğitim self-servis geçici olarak kullanılamıyor")} body={c(locale, "No employee learning progress was changed. The governed learning read surface remains available.", "Hiçbir çalışan eğitim ilerlemesi değiştirilmedi. Yönetişimli eğitim salt-okunur görünümü kullanılabilir.")}/>;
      }
    }

    if (writeCapability && can(ctx, writeCapability)) {
      try {
        if (slug === "performance") {
          const [{ PerformanceOperationsConsole }, { getPerformanceOperationsData }] = await Promise.all([
            import("@/components/performance-operations-console"),
            import("@/lib/performance-operations-data")
          ]);
          const data = await getPerformanceOperationsData(ctx);
          operations = <PerformanceOperationsConsole {...data}/>;
        } else {
          const [{ GrowthOperationsConsole }, { getGrowthOperationsData }] = await Promise.all([
            import("@/components/growth-operations-console"),
            import("@/lib/growth-operations-data")
          ]);
          const writeSlug = slug as GrowthWriteSlug;
          const data = await getGrowthOperationsData(ctx, writeSlug);
          operations = <GrowthOperationsConsole slug={writeSlug} {...data}/>;
        }
      } catch (operationsError) {
        console.error(`[HRBP] ${slug} operations console could not initialize; live read surface remains available.`, operationsError);
        operations = <ConsoleWarning locale={locale} title={c(locale, "Governed write console is temporarily unavailable", "Yönetişimli yazma konsolu geçici olarak kullanılamıyor")} body={c(locale, "Live domain data remains read-only until the transaction console recovers.", "İşlem konsolu toparlanana kadar canlı alan verisi salt-okunur kalır.")}/>;
      }

      if (slug === "benefits" || slug === "learning" || slug === "succession" || slug === "talent") {
        try {
          if (slug === "succession") {
            const [{ SuccessionGovernanceConsole }, { getSuccessionGovernanceData }] = await Promise.all([
              import("@/components/succession-governance-console"),
              import("@/lib/succession-governance-data")
            ]);
            const allowLearningPlan = can(ctx, "learning:write");
            const data = await getSuccessionGovernanceData(ctx, { includeDevelopmentCatalog: allowLearningPlan });
            lifecycle = <SuccessionGovernanceConsole {...data} allowLearningPlan={allowLearningPlan}/>;
          } else if (slug === "talent") {
            const [{ TalentGovernanceConsole }, { getTalentGovernanceData }] = await Promise.all([
              import("@/components/talent-governance-console"),
              import("@/lib/talent-governance-data")
            ]);
            const data = await getTalentGovernanceData(ctx);
            lifecycle = <TalentGovernanceConsole {...data}/>;
          } else if (slug === "learning") {
            const [{ GrowthLifecycleConsole }, lifecycleData, { LearningGovernanceConsole }, { getLearningGovernanceData }] = await Promise.all([
              import("@/components/growth-lifecycle-console"),
              import("@/lib/growth-lifecycle-data"),
              import("@/components/learning-governance-console"),
              import("@/lib/learning-governance-data")
            ]);
            const [assignments, governance] = await Promise.all([
              lifecycleData.getLearningAssignmentOperationsData(ctx),
              getLearningGovernanceData(ctx)
            ]);
            lifecycle = <><GrowthLifecycleConsole slug="learning" assignments={assignments}/><LearningGovernanceConsole {...governance}/></>;
          } else {
            const [{ GrowthLifecycleConsole }, lifecycleData, { BenefitsGovernanceConsole }, { getBenefitsGovernanceData }] = await Promise.all([
              import("@/components/growth-lifecycle-console"),
              import("@/lib/growth-lifecycle-data"),
              import("@/components/benefits-governance-console"),
              import("@/lib/benefits-governance-data")
            ]);
            const [enrollments, plans] = await Promise.all([
              lifecycleData.getBenefitEnrollmentOperationsData(ctx),
              getBenefitsGovernanceData(ctx)
            ]);
            lifecycle = <><GrowthLifecycleConsole slug="benefits" enrollments={enrollments}/><BenefitsGovernanceConsole plans={plans}/></>;
          }
        } catch (lifecycleError) {
          console.error(`[HRBP] ${slug} lifecycle queue could not initialize.`, lifecycleError);
          lifecycle = <ConsoleWarning locale={locale} title={c(locale, "Lifecycle queue is temporarily unavailable", "Yaşam döngüsü kuyruğu geçici olarak kullanılamıyor")} body={c(locale, "Creation remains available, but transition actions are hidden until the governed queue recovers.", "Oluşturma işlemleri kullanılabilir; ancak yönetişimli kuyruk toparlanana kadar geçiş aksiyonları gizlenir.")}/>;
        }
      }
    }

    return <AppShell>
      <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="module-heading-actions"><button className="secondary-button" disabled><CircleCheckBig size={16}/> {c(locale, "Governed live data", "Yönetişimli canlı veri")}</button></div></section>
      {liveWorkspace}
      {participant}
      {operations}
      {lifecycle}
    </AppShell>;
  } catch (error) {
    console.error(`[HRBP] Dedicated ${slug} workspace failed; protected fallback activated.`, error);
    return <AppShell>
      <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="module-heading-actions"><button className="secondary-button" disabled><CircleAlert size={16}/> {c(locale, "Protected fallback", "Korumalı yedek mod")}</button></div></section>
      <section className="card module-table"><div className="empty-state"><CircleAlert size={24}/><h3>{c(locale, `${meta.title} is temporarily unavailable`, `${meta.title} geçici olarak kullanılamıyor`)}</h3><p>{c(locale, "The governed data plane could not initialize. No demo values are substituted and no mutation was attempted.", "Yönetişimli veri katmanı başlatılamadı. Yerine demo değer konulmadı ve hiçbir değişiklik işlemi denenmedi.")}</p></div></section>
    </AppShell>;
  }
}
