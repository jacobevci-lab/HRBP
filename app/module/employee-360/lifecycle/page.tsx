import Link from "next/link";
import { CircleAlert, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { can } from "@/lib/authorization";
import { getServerLocale } from "@/lib/i18n-server";
import { getServerRequestContext } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const copy = {
  en: {
    eyebrow: "HRBP One / Employee lifecycle",
    liveEyebrow: "HRBP One / Employee 360 / Lifecycle",
    title: "Lifecycle command",
    summary: "Governed employee movement and separation controls.",
    liveSummary: "Execute controlled employee movement without bypassing position, audit, privacy or separation controls.",
    authTitle: "Authentication required",
    authBody: "Employee lifecycle mutations are not available on the public staging surface.",
    signIn: "Sign in with enterprise SSO",
    selectSummary: "Select an employee from the People directory before initiating a governed change.",
    noContextTitle: "No authorized employee context",
    noContextBody: "Open an employee record first, then return to lifecycle actions.",
    openPeople: "Open People",
    back: "Back to Employee 360",
    unavailableTitle: "Lifecycle data is temporarily unavailable",
    unavailableBody: "The employee data plane could not initialize. No mutation was attempted.",
    returnToEmployee: "Return to Employee 360"
  },
  tr: {
    eyebrow: "HRBP One / Çalışan yaşam döngüsü",
    liveEyebrow: "HRBP One / Çalışan 360 / Yaşam döngüsü",
    title: "Yaşam döngüsü yönetimi",
    summary: "Çalışan hareketlerini ve ayrılış kontrollerini yönetişimli biçimde yönetin.",
    liveSummary: "Pozisyon, denetim, gizlilik veya ayrılış kontrollerini atlamadan kontrollü çalışan hareketlerini yönetin.",
    authTitle: "Kimlik doğrulama gerekli",
    authBody: "Çalışan yaşam döngüsü değişiklikleri herkese açık önizleme alanında kullanılamaz.",
    signIn: "Kurumsal SSO ile giriş yap",
    selectSummary: "Yönetişimli bir değişiklik başlatmadan önce Çalışanlar dizininden bir çalışan seçin.",
    noContextTitle: "Yetkili çalışan bağlamı yok",
    noContextBody: "Önce bir çalışan kaydı açın, ardından yaşam döngüsü işlemlerine geri dönün.",
    openPeople: "Çalışanları aç",
    back: "Çalışan 360'a dön",
    unavailableTitle: "Yaşam döngüsü verileri geçici olarak kullanılamıyor",
    unavailableBody: "Çalışan veri katmanı başlatılamadı. Herhangi bir değişiklik işlemi denenmedi.",
    returnToEmployee: "Çalışan 360'a dön"
  }
} as const;

export default async function EmployeeLifecyclePage({ searchParams }: { searchParams: SearchParams }) {
  const [search, ctx, locale] = await Promise.all([searchParams, getServerRequestContext(), getServerLocale()]);
  const personId = typeof search.person === "string" ? search.person : "";
  const text = copy[locale];

  if (!ctx) {
    return <AppShell><section className="page-heading"><div><div className="eyebrow">{text.eyebrow}</div><h1>{text.title}</h1><p>{text.summary}</p></div></section><section className="card employee-restricted-card"><ShieldCheck size={22}/><div><h3>{text.authTitle}</h3><p>{text.authBody}</p><Link className="secondary-button" style={{ marginTop: 12 }} href={`/auth/sign-in?returnTo=${encodeURIComponent(`/module/employee-360/lifecycle?person=${personId}`)}`}>{text.signIn}</Link></div></section></AppShell>;
  }

  if (!personId || !can(ctx, "people:read")) {
    return <AppShell><section className="page-heading"><div><div className="eyebrow">{text.eyebrow}</div><h1>{text.title}</h1><p>{text.selectSummary}</p></div></section><section className="card module-table"><div className="empty-state"><CircleAlert size={24}/><h3>{text.noContextTitle}</h3><p>{text.noContextBody}</p><Link className="secondary-button" href="/module/people">{text.openPeople}</Link></div></section></AppShell>;
  }

  try {
    const { getEmployee360Data } = await import("@/lib/core-hr-live-data");
    const person = await getEmployee360Data(personId, { tenantId: ctx.tenantId });
    if (!person) throw new Error("PERSON_NOT_FOUND");
    const { EmployeeLifecycleConsole } = await import("@/components/employee-lifecycle-console");
    const canMove = can(ctx, "people:write") && can(ctx, "positions:write");
    const canOffboard = can(ctx, "offboarding:write");

    return <AppShell>
      <section className="page-heading module-heading">
        <div><div className="eyebrow">{text.liveEyebrow}</div><h1>{text.title}</h1><p>{text.liveSummary}</p></div>
        <div className="module-heading-actions"><Link className="secondary-button" href={`/module/employee-360?person=${encodeURIComponent(person.id)}&tab=employment`}>{text.back}</Link></div>
      </section>
      <EmployeeLifecycleConsole personId={person.id} employeeName={person.name} currentPosition={person.position} currentDepartment={person.department} canMove={canMove} canOffboard={canOffboard}/>
    </AppShell>;
  } catch (error) {
    console.error("[HRBP] Employee lifecycle command failed to initialize.", error);
    return <AppShell><section className="page-heading"><div><div className="eyebrow">{text.eyebrow}</div><h1>{text.title}</h1><p>{text.summary}</p></div></section><section className="card module-table"><div className="empty-state"><CircleAlert size={24}/><h3>{text.unavailableTitle}</h3><p>{text.unavailableBody}</p><Link className="secondary-button" href={`/module/employee-360?person=${encodeURIComponent(personId)}`}>{text.returnToEmployee}</Link></div></section></AppShell>;
  }
}
