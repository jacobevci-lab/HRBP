"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Save, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { useLocale } from "@/components/locale-provider";

export type EmployeePositionOption = { id: string; code: string; title: string; org: string; location: string };

export function EmployeeCreateForm({ positions }: { positions: EmployeePositionOption[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const tr = locale === "tr";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresAuth, setRequiresAuth] = useState(false);
  const c = (en: string, trValue: string) => tr ? trValue : en;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true); setError(null); setRequiresAuth(false);
    const form = new FormData(event.currentTarget);
    const payload = {
      employeeNumber: String(form.get("employeeNumber") ?? ""), givenName: String(form.get("givenName") ?? ""), familyName: String(form.get("familyName") ?? ""), workEmail: String(form.get("workEmail") ?? ""), startDate: String(form.get("startDate") ?? ""), positionId: String(form.get("positionId") ?? "")
    };
    try {
      const response = await fetch("/api/people", { method: "POST", headers: { "content-type": "application/json", "x-purpose": "Employee administration" }, body: JSON.stringify(payload) });
      const value = await response.json() as { data?: { person?: { id?: string } }; error?: string };
      if (!response.ok) {
        if (response.status === 401) setRequiresAuth(true);
        setError(value.error || c("Employee record could not be created.", "Çalışan kaydı oluşturulamadı."));
        return;
      }
      const personId = value.data?.person?.id;
      router.push(personId ? `/module/employee-360?person=${encodeURIComponent(personId)}` : "/module/people");
      router.refresh();
    } catch {
      setError(c("The request could not reach HRBP. Try again.", "İstek HRBP'ye ulaştırılamadı. Tekrar deneyin."));
    } finally { setSubmitting(false); }
  }

  return <div className="card record-form-card">
    <div className="record-form-header"><h2>{c("Employee golden record","Çalışan ana kaydı")}</h2><p>{c("Create identity and employment together, assign a governed position and start the lifecycle ledger in one transaction.","Kimlik ve istihdam kaydını birlikte oluşturun, yönetişim kontrollü bir pozisyon atayın ve yaşam döngüsü kaydını tek işlemde başlatın.")}</p></div>
    <form className="record-form" onSubmit={submit}>
      <div className="form-field"><label htmlFor="employeeNumber">{c("Employee number","Çalışan numarası")}</label><input id="employeeNumber" name="employeeNumber" required autoComplete="off" placeholder="E0013"/><span className="form-hint">{c("Unique inside the tenant.","Tenant içinde benzersiz olmalıdır.")}</span></div>
      <div className="form-field"><label htmlFor="startDate">{c("Start date","Başlangıç tarihi")}</label><input id="startDate" name="startDate" required type="date"/><span className="form-hint">{c("Future dates create a preboarding employment and onboarding plan.","Gelecek tarihli başlangıçlar preboarding istihdamı ve onboarding planı oluşturur.")}</span></div>
      <div className="form-field"><label htmlFor="givenName">{c("Given name","Ad")}</label><input id="givenName" name="givenName" required autoComplete="given-name"/></div>
      <div className="form-field"><label htmlFor="familyName">{c("Family name","Soyad")}</label><input id="familyName" name="familyName" required autoComplete="family-name"/></div>
      <div className="form-field full"><label htmlFor="workEmail">{c("Work email","İş e-postası")}</label><input id="workEmail" name="workEmail" required type="email" autoComplete="email" placeholder="employee@company.com"/></div>
      <div className="form-field full"><label htmlFor="positionId">{c("Position","Pozisyon")}</label><select id="positionId" name="positionId" required defaultValue=""><option value="" disabled>{c("Select an available position","Uygun bir pozisyon seçin")}</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.code} · {position.title} · {position.org} · {position.location}</option>)}</select><span className="form-hint">{c("Position and employee remain separate records; assignment fills the selected seat.","Pozisyon ve çalışan ayrı kayıtlar olarak kalır; atama seçilen kadroyu doldurur.")}</span></div>
      {positions.length === 0 ? <div className="form-error">{c("There are no OPEN positions. Create a position before hiring an employee.","AÇIK pozisyon bulunmuyor. Çalışan oluşturmadan önce pozisyon oluşturun.")}</div> : null}
      {error ? <div className="form-error">{error}{requiresAuth ? <> <Link href="/auth/sign-in?returnTo=%2Fmodule%2Fpeople%2Fnew">{c("Sign in with enterprise SSO.","Kurumsal SSO ile giriş yapın.")}</Link></> : null}</div> : null}
      <div className="form-actions"><Link className="secondary-button" href="/module/people">{c("Cancel","İptal")}</Link><button className="create-button" type="submit" disabled={submitting || positions.length === 0}><Save size={15}/>{submitting ? c("Creating…","Oluşturuluyor…") : c("Create employee","Çalışan oluştur")}</button></div>
    </form>
    <div className="governance-note" style={{ margin: "0 20px 20px" }}><ShieldCheck size={17}/><p>{c("The API requires a signed enterprise session, tenant-scoped write permission, same-origin mutation and writes lifecycle + audit evidence atomically with the employee record.","API; imzalı kurumsal oturum, tenant kapsamlı yazma yetkisi ve same-origin mutation kontrolü ister; yaşam döngüsü ile denetim kanıtını çalışan kaydıyla atomik olarak yazar.")}</p></div>
  </div>;
}
