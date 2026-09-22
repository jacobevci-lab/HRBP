import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmployeeCreateForm, type EmployeePositionOption } from "@/components/employee-create-form";
import { withDb } from "@/lib/db";
import { workspaceTenantId } from "@/lib/workspace";
import { getServerLocale } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewEmployeePage() {
  const locale = await getServerLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const positions = await withDb(async (db) => {
    const rows = await db.position.findMany({ where: { tenantId: workspaceTenantId(), validTo: null, status: "OPEN" }, orderBy: [{ orgUnit: { name: "asc" } }, { positionCode: "asc" }], select: { id: true, positionCode: true, title: true, location: true, orgUnit: { select: { name: true } } } });
    return rows.map<EmployeePositionOption>((position) => ({ id: position.id, code: position.positionCode, title: position.title, org: position.orgUnit.name, location: position.location ?? c("Unspecified","Belirtilmedi") }));
  });
  return <AppShell><div className="record-form-page"><section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {c("People","Çalışanlar")} / {c("Create","Oluştur")}</div><h1>{c("Create employee","Çalışan oluştur")}</h1><p>{c("Start one governed employee relationship from a single golden record and position assignment.","Tek bir çalışan ana kaydı ve pozisyon ataması üzerinden yönetişim kontrollü çalışan ilişkisini başlatın.")}</p></div><div className="module-heading-actions"><Link className="secondary-button" href="/module/people"><ChevronLeft size={15}/> {c("People","Çalışanlar")}</Link><Link className="secondary-button" href="/auth/sign-in?returnTo=%2Fmodule%2Fpeople%2Fnew"><ShieldCheck size={15}/> {c("Sign in","Giriş yap")}</Link></div></section><EmployeeCreateForm positions={positions}/></div></AppShell>;
}
