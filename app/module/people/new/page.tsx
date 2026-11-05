import Link from "next/link";
import { ChevronLeft, LockKeyhole } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmployeeCreateForm, type EmployeePositionOption } from "@/components/employee-create-form";
import { withDb } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n-server";
import { getServerRequestContext } from "@/lib/server-session";
import { canCreateEmployeeMasterRecord } from "@/lib/workforce-master-data-access";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewEmployeePage() {
  const [locale, ctx] = await Promise.all([getServerLocale(), getServerRequestContext()]);
  if (!ctx) redirect("/auth/sign-in?returnTo=%2Fmodule%2Fpeople%2Fnew");
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  if (!canCreateEmployeeMasterRecord(ctx)) {
    return <AppShell><div className="record-form-page"><div className="card employee-restricted-card"><LockKeyhole size={22}/><div><h3>{c("Employee creation access is restricted","Çalışan oluşturma erişimi kısıtlı")}</h3><p>{c("Creating workforce master records requires an operational tenant-wide role.","Çalışan ana kaydı oluşturmak tenant genelinde operasyonel bir rol gerektirir.")}</p></div></div></div></AppShell>;
  }
  const positions = await withDb(async (db) => {
    const rows = await db.position.findMany({ where: { tenantId: ctx.tenantId, validTo: null, status: "OPEN" }, orderBy: [{ orgUnit: { name: "asc" } }, { positionCode: "asc" }], select: { id: true, positionCode: true, title: true, location: true, orgUnit: { select: { name: true } } } });
    return rows.map<EmployeePositionOption>((position) => ({ id: position.id, code: position.positionCode, title: position.title, org: position.orgUnit.name, location: position.location ?? c("Unspecified","Belirtilmedi") }));
  });
  return <AppShell><div className="record-form-page"><section className="page-heading module-heading"><div><div className="eyebrow">HRBP One / {c("People","Çalışanlar")} / {c("Create","Oluştur")}</div><h1>{c("Create employee","Çalışan oluştur")}</h1><p>{c("Start one governed employee relationship from a single golden record and position assignment.","Tek bir çalışan ana kaydı ve pozisyon ataması üzerinden yönetişim kontrollü çalışan ilişkisini başlatın.")}</p></div><div className="module-heading-actions"><Link className="secondary-button" href="/module/people"><ChevronLeft size={15}/> {c("People","Çalışanlar")}</Link></div></section><EmployeeCreateForm positions={positions}/></div></AppShell>;
}
