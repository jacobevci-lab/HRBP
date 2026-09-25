import { CircleAlert, CircleCheckBig, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { can, type Capability } from "@/lib/authorization";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";
import { getServerRequestContext } from "@/lib/server-session";

type Slug = "time-attendance" | "leave" | "compensation" | "payroll";

const copy: Record<Slug, { en: { title: string; description: string }; tr: { title: string; description: string } }> = {
  "time-attendance": {
    en: { title: "Time & Attendance", description: "Operate governed schedules, attendance, overtime, exceptions and payroll-ready time from relationship-scoped employment data." },
    tr: { title: "Zaman & Devam", description: "İlişki kapsamlı istihdam verisiyle çalışma planı, devam, fazla mesai, istisna ve bordroya hazır zamanı yönetin." }
  },
  leave: {
    en: { title: "Leave", description: "Manage leave requests, balances and approvals without disconnecting policy, employment scope or audit evidence." },
    tr: { title: "İzin", description: "Politika, istihdam kapsamı ve denetim kanıtından kopmadan izin taleplerini, bakiyeleri ve onayları yönetin." }
  },
  compensation: {
    en: { title: "Compensation", description: "Run restricted effective-dated compensation changes with approval separation and immutable salary history." },
    tr: { title: "Ücretlendirme", description: "Onay ayrımı ve değiştirilemez ücret geçmişiyle kısıtlı, tarih-etkin ücret değişikliklerini yönetin." }
  },
  payroll: {
    en: { title: "Payroll", description: "Access released employee payroll statements or, with separated payroll authority, operate country-pack periods, controlled runs and auditable results." },
    tr: { title: "Bordro", description: "Yayınlanmış çalışan bordro dökümlerine erişin veya ayrıştırılmış bordro yetkisiyle ülke paketi dönemlerini, kontrollü run'ları ve denetlenebilir sonuçları yönetin." }
  }
};

function capabilityFor(slug: Slug): Capability {
  if (slug === "time-attendance") return "time:read";
  if (slug === "leave") return "leave:read";
  if (slug === "compensation") return "compensation:read";
  return "payroll:self-payslip";
}

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }

function ConsoleWarning({ locale, title, body }: { locale: Locale; title: string; body: string }) {
  return <section className="card module-degraded-banner" style={{ marginTop: 14, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}><CircleAlert size={18}/><div><strong style={{ display: "block", fontSize: 11 }}>{title}</strong><p style={{ margin: "3px 0 0", fontSize: 9.5, lineHeight: 1.5 }}>{body}</p></div></section>;
}

export async function WorkPayModulePage({ slug }: { slug: Slug }) {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  const meta = copy[slug][locale];
  const capability = capabilityFor(slug);

  if (!ctx) {
    const { WorkPayWorkspace } = await import("@/components/work-pay-workspace");
    return <AppShell>
      <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="module-heading-actions"><button className="secondary-button" disabled><ShieldCheck size={16}/> {c(locale, "Read-only staging preview", "Salt-okunur staging önizlemesi")}</button></div></section>
      <section className="card module-degraded-banner" style={{ marginBottom: 14, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}><ShieldCheck size={18} style={{ flex: "0 0 auto", marginTop: 1 }}/><div><strong style={{ display: "block", fontSize: 11 }}>{c(locale, "Safe demo data", "Güvenli demo verisi")}</strong><p style={{ margin: "3px 0 0", fontSize: 9.5, lineHeight: 1.5 }}>{c(locale, "This public staging view uses sample values only. Protected payroll, compensation and employee records remain unavailable until you sign in with an authorized role.", "Bu genel staging görünümü yalnızca örnek değerler kullanır. Korumalı bordro, ücret ve çalışan kayıtları, yetkili bir rolle giriş yapılana kadar kullanılamaz.")}</p></div></section>
      <WorkPayWorkspace slug={slug}/>
    </AppShell>;
  }

  if (!can(ctx, capability)) {
    return <AppShell>
      <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div></section>
      <section className="card module-table"><div className="empty-state"><ShieldCheck size={24}/><h3>{c(locale, "Access is restricted", "Erişim kısıtlı")}</h3><p>{c(locale, `Your signed role does not include ${capability}.`, `İmzalı rolünüz ${capability} yetkisini içermiyor.`)}</p></div></section>
    </AppShell>;
  }

  if (slug === "payroll" && !can(ctx, "payroll:read") && !ctx.employmentId) {
    return <AppShell>
      <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div></section>
      <section className="card module-table"><div className="empty-state"><ShieldCheck size={24}/><h3>{c(locale, "Employment identity required", "İstihdam kimliği gerekli")}</h3><p>{c(locale, "Payroll self-service is bound to the employment identity inside your signed session. No payroll statement can be opened without that relationship.", "Bordro self-servis, imzalı oturumunuzdaki istihdam kimliğine bağlıdır. Bu ilişki olmadan hiçbir bordro dökümü açılamaz.")}</p></div></section>
    </AppShell>;
  }

  try {
    let content: React.ReactNode;
    if (slug === "compensation") {
      content = await (await import("@/components/compensation-live-workspace")).CompensationLiveWorkspace();
    } else if (slug === "payroll" && !can(ctx, "payroll:read")) {
      const [{ PayrollPayslipWorkspace }, { getPayrollSelfServiceData }] = await Promise.all([
        import("@/components/payroll-payslip-workspace"),
        import("@/lib/payroll-payslip-data")
      ]);
      const data = await getPayrollSelfServiceData(ctx);
      content = <PayrollPayslipWorkspace data={data}/>;
    } else {
      content = await (await import("@/components/work-pay-live-workspace")).WorkPayLiveWorkspace({ slug: slug as "time-attendance" | "leave" | "payroll" });
    }
    let participant: React.ReactNode = null;

    if (slug === "time-attendance" && ctx.employmentId && can(ctx, "time:self-entry")) {
      try {
        const [{ TimeParticipantConsole }, { getTimeParticipantData }] = await Promise.all([
          import("@/components/time-participant-console"),
          import("@/lib/time-participant-data")
        ]);
        const data = await getTimeParticipantData(ctx);
        participant = <TimeParticipantConsole employmentId={ctx.employmentId} data={data}/>;
      } catch (participantError) {
        console.error("[HRBP] time self-service could not initialize.", participantError);
        participant = <ConsoleWarning locale={locale} title={c(locale, "Time self-service is temporarily unavailable", "Zaman self-servis geçici olarak kullanılamıyor")} body={c(locale, "No time mutation was attempted. The governed time operating view remains available while self-service recovers.", "Hiçbir zaman kaydı değişikliği denenmedi. Self-servis toparlanırken yönetişimli zaman operasyon görünümü kullanılabilir.")}/>;
      }
    }

    if (slug === "leave" && ctx.employmentId && can(ctx, "leave:self-request")) {
      try {
        const [{ LeaveParticipantConsole }, { getLeaveParticipantData }] = await Promise.all([
          import("@/components/leave-participant-console"),
          import("@/lib/leave-participant-data")
        ]);
        const data = await getLeaveParticipantData(ctx);
        participant = <LeaveParticipantConsole employmentId={ctx.employmentId} data={data}/>;
      } catch (participantError) {
        console.error("[HRBP] leave self-service could not initialize.", participantError);
        participant = <ConsoleWarning locale={locale} title={c(locale, "Leave self-service is temporarily unavailable", "İzin self-servis geçici olarak kullanılamıyor")} body={c(locale, "No leave mutation was attempted. The governed leave operating view remains available while self-service recovers.", "Hiçbir izin değişikliği denenmedi. Self-servis toparlanırken yönetişimli izin operasyon görünümü kullanılabilir.")}/>;
      }
    }

    return <AppShell>
      <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="module-heading-actions"><button className="secondary-button" disabled><CircleCheckBig size={16}/> {c(locale, "Governed live data", "Yönetişimli canlı veri")}</button></div></section>
      {content}
      {participant}
    </AppShell>;
  } catch (error) {
    console.error(`[HRBP] Dedicated ${slug} workspace failed; protected fallback activated.`, error);
    return <AppShell>
      <section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {meta.title}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="module-heading-actions"><button className="secondary-button" disabled><CircleAlert size={16}/> {c(locale, "Protected fallback", "Korumalı yedek mod")}</button></div></section>
      <section className="card module-table"><div className="empty-state"><CircleAlert size={24}/><h3>{c(locale, `${meta.title} is temporarily unavailable`, `${meta.title} geçici olarak kullanılamıyor`)}</h3><p>{c(locale, "The governed data plane could not initialize. No demo values are substituted and no protected mutation was attempted.", "Yönetişimli veri katmanı başlatılamadı. Yerine demo değer konulmadı ve hiçbir korumalı değişiklik işlemi denenmedi.")}</p></div></section>
    </AppShell>;
  }
}
