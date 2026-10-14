import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmployeeCreateForm, type EmployeePositionOption } from "@/components/employee-create-form";
import { withDb } from "@/lib/db";
import { getServerRequestContext } from "@/lib/server-session";
import { can } from "@/lib/authorization";
import { redirect } from "next/navigation";
import { getServerLocale } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewEmployeePage() {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx) redirect("/auth/sign-in?returnTo=%2Fmodule%2Fpeople%2Fnew");
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  // Authorization precedes every business-data lookup and client prop.
  if (!can(ctx, "people:read") || !can(ctx, "people:write") || !can(ctx, "positions:read")) {
    return <AppShell><section data-record-create-state="restricted" data-record-create-kind="people">
      <section className="page-heading module-heading"><div><h1>{c("Create employee","Çalışan oluştur")}</h1></div></section>
      <section className="card module-table"><div className="empty-state"><ShieldCheck size={24}/>
        <h2>{c("Access is restricted","Erişim kısıtlı")}</h2>
        <p>{c("Your current permissions do not allow this record to be created.","Mevcut yetkileriniz bu kaydı oluşturmaya izin vermiyor.")}</p>
        <Link className="secondary-button" href="/">{c("Back to workspace","Çalışma alanına dön")}</Link>
      </div></section>
    </section></AppShell>;
  }
  const positions = await withDb(async (db) => {
    const rows = await db.position.findMany({ where: { tenantId: ctx.tenantId, validTo: null, status: "OPEN" }, orderBy: [{ orgUnit: { name: "asc" } }, { positionCode: "asc" }], select: { id: true, positionCode: true, title: true, location: true, orgUnit: { select: { name: true } } } });
    return rows.map<EmployeePositionOption>((position) => ({ id: position.id, code: position.positionCode, title: position.title, org: position.orgUnit.name, location: position.location ?? c("Unspecified","Belirtilmedi") }));
  });
  return <AppShell><div className="record-form-page"><section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {c("People","Çalışanlar")} / {c("Create","Oluştur")}</div><h1>{c("Create employee","Çalışan oluştur")}</h1><p>{c("Start one governed employee relationship from a single golden record and position assignment.","Tek bir çalışan ana kaydı ve pozisyon ataması üzerinden yönetişim kontrollü çalışan ilişkisini başlatın.")}</p></div><div className="module-heading-actions"><Link className="secondary-button" href="/module/people"><ChevronLeft size={15}/> {c("People","Çalışanlar")}</Link></div></section><EmployeeCreateForm positions={positions}/></div></AppShell>;
}
