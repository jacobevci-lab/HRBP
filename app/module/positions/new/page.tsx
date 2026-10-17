import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PositionCreateForm, type OrganizationOption } from "@/components/position-create-form";
import { withDb } from "@/lib/db";
import { getServerRequestContext } from "@/lib/server-session";
import { can } from "@/lib/authorization";
import { redirect } from "next/navigation";
import { getServerLocale } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function typeLabel(value: string, tr: boolean) {
  const english = value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
  if (!tr) return english;
  const map: Record<string,string> = { LEGAL_ENTITY:"Tüzel Kişilik", BUSINESS_UNIT:"İş Birimi", DEPARTMENT:"Departman", TEAM:"Takım", COST_CENTER:"Maliyet Merkezi" };
  return map[value.toUpperCase()] ?? english;
}

export default async function NewPositionPage() {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx) redirect("/auth/sign-in?returnTo=%2Fmodule%2Fpositions%2Fnew");
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  // Authorization precedes every business-data lookup and client prop.
  if (!can(ctx, "positions:read") || !can(ctx, "positions:write") || !can(ctx, "organization:read")) {
    return <AppShell><section data-record-create-state="restricted" data-record-create-kind="positions">
      <section className="page-heading module-heading"><div><h1>{c("Create position","Pozisyon oluştur")}</h1></div></section>
      <section className="card module-table"><div className="empty-state"><ShieldCheck size={24}/>
        <h2>{c("Access is restricted","Erişim kısıtlı")}</h2>
        <p>{c("Your current permissions do not allow this record to be created.","Mevcut yetkileriniz bu kaydı oluşturmaya izin vermiyor.")}</p>
        <Link className="secondary-button" href="/">{c("Back to workspace","Çalışma alanına dön")}</Link>
      </div></section>
    </section></AppShell>;
  }
  const organizations = await withDb(async (db) => {
    const rows = await db.organizationUnit.findMany({ where: { tenantId: ctx.tenantId, validTo: null }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, type: true } });
    return rows.map<OrganizationOption>((org) => ({ id: org.id, code: org.code, name: org.name, type: typeLabel(org.type, tr) }));
  });
  return <AppShell><div className="record-form-page"><section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {c("Positions","Pozisyonlar")} / {c("Create","Oluştur")}</div><h1>{c("Create position","Pozisyon oluştur")}</h1><p>{c("Create a governed, budgetable seat before assigning or recruiting an incumbent.","Bir çalışan atamadan veya işe alım başlatmadan önce yönetişim kontrollü, bütçelenebilir bir kadro oluşturun.")}</p></div><div className="module-heading-actions"><Link className="secondary-button" href="/module/positions"><ChevronLeft size={15}/> {c("Positions","Pozisyonlar")}</Link></div></section><PositionCreateForm organizations={organizations}/></div></AppShell>;
}
