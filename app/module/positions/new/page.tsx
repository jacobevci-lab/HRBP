import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PositionCreateForm, type JobProfileOption, type OrganizationOption } from "@/components/position-create-form";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n-server";
import { getServerRequestContext } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function typeLabel(value: string, tr: boolean) {
  const english = value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
  if (!tr) return english;
  const map: Record<string,string> = { LEGAL_ENTITY:"Tüzel Kişilik", BUSINESS_UNIT:"İş Birimi", DEPARTMENT:"Departman", TEAM:"Takım", COST_CENTER:"Maliyet Merkezi" };
  return map[value.toUpperCase()] ?? english;
}

export default async function NewPositionPage() {
  const [locale, ctx] = await Promise.all([getServerLocale(), getServerRequestContext()]);
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;

  if (!ctx) return <AppShell><section className="card"><div className="empty-state"><ShieldCheck size={24}/><h3>{c("Authentication required","Kimlik doğrulama gerekli")}</h3><p>{c("Creating a position requires an authenticated tenant session.","Pozisyon oluşturmak kimliği doğrulanmış bir tenant oturumu gerektirir.")}</p><Link className="create-button" href="/auth/sign-in?returnTo=%2Fmodule%2Fpositions%2Fnew">{c("Sign in","Giriş yap")}</Link></div></section></AppShell>;
  if (!can(ctx, "positions:write")) return <AppShell><section className="card"><div className="empty-state"><ShieldCheck size={24}/><h3>{c("Position creation is restricted","Pozisyon oluşturma kısıtlı")}</h3><p>{c("Your role does not include positions:write.","Rolünüz positions:write yetkisini içermiyor.")}</p><Link className="secondary-button" href="/module/positions">{c("Back to positions","Pozisyonlara dön")}</Link></div></section></AppShell>;

  const now = new Date();
  const { organizations, jobProfiles } = await withDb(async (db) => {
    const [orgRows, profileRows] = await Promise.all([
      db.organizationUnit.findMany({
        where: { tenantId: ctx.tenantId, validTo: null },
        orderBy: [{ type: "asc" }, { name: "asc" }],
        select: { id: true, code: true, name: true, type: true }
      }),
      db.jobProfile.findMany({
        where: {
          tenantId: ctx.tenantId,
          status: "ACTIVE",
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }]
        },
        orderBy: [{ family: { name: "asc" } }, { level: { rank: "asc" } }, { title: "asc" }],
        select: {
          id: true, code: true, title: true,
          family: { select: { name: true } },
          level: { select: { code: true, name: true, rank: true } }
        }
      })
    ]);
    return {
      organizations: orgRows.map<OrganizationOption>((org) => ({ id: org.id, code: org.code, name: org.name, type: typeLabel(org.type, tr) })),
      jobProfiles: profileRows.map<JobProfileOption>((profile) => ({
        id: profile.id,
        code: profile.code,
        title: profile.title,
        familyName: profile.family.name,
        levelCode: profile.level.code,
        levelName: profile.level.name,
        rank: profile.level.rank
      }))
    };
  });

  return <AppShell><div className="record-form-page"><section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {c("Positions","Pozisyonlar")} / {c("Create","Oluştur")}</div><h1>{c("Create position","Pozisyon oluştur")}</h1><p>{c("Create a governed, budgetable seat and optionally bind it to the current structured job architecture.","Yönetişim kontrollü, bütçelenebilir bir kadro oluşturun ve opsiyonel olarak güncel yapısal iş mimarisine bağlayın.")}</p></div><div className="module-heading-actions"><Link className="secondary-button" href="/module/positions"><ChevronLeft size={15}/> {c("Positions","Pozisyonlar")}</Link>{can(ctx, "job-architecture:read") ? <Link className="secondary-button" href="/module/job-architecture"><ShieldCheck size={15}/> {c("Job architecture","İş mimarisi")}</Link> : null}</div></section><PositionCreateForm organizations={organizations} jobProfiles={jobProfiles}/></div></AppShell>;
}
