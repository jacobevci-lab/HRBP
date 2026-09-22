import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PositionCreateForm, type OrganizationOption } from "@/components/position-create-form";
import { withDb } from "@/lib/db";
import { workspaceTenantId } from "@/lib/workspace";
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
  const locale = await getServerLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const organizations = await withDb(async (db) => {
    const rows = await db.organizationUnit.findMany({ where: { tenantId: workspaceTenantId(), validTo: null }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, type: true } });
    return rows.map<OrganizationOption>((org) => ({ id: org.id, code: org.code, name: org.name, type: typeLabel(org.type, tr) }));
  });
  return <AppShell><div className="record-form-page"><section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {c("Positions","Pozisyonlar")} / {c("Create","Oluştur")}</div><h1>{c("Create position","Pozisyon oluştur")}</h1><p>{c("Create a governed, budgetable seat before assigning or recruiting an incumbent.","Bir çalışan atamadan veya işe alım başlatmadan önce yönetişim kontrollü, bütçelenebilir bir kadro oluşturun.")}</p></div><div className="module-heading-actions"><Link className="secondary-button" href="/module/positions"><ChevronLeft size={15}/> {c("Positions","Pozisyonlar")}</Link><Link className="secondary-button" href="/auth/sign-in?returnTo=%2Fmodule%2Fpositions%2Fnew"><ShieldCheck size={15}/> {c("Sign in","Giriş yap")}</Link></div></section><PositionCreateForm organizations={organizations}/></div></AppShell>;
}
