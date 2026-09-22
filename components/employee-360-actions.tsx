"use client";

import { useRouter } from "next/navigation";
import { BadgeDollarSign, Save, UserCog } from "lucide-react";
import { FormEvent, useState } from "react";
import { useLocale } from "@/components/locale-provider";

export type ManagerOption = { employmentId: string; name: string; position: string };

function Feedback({ state }: { state: { type: "success" | "error"; message: string } | null }) {
  if (!state) return null;
  return <div className={state.type === "success" ? "employee-action-success" : "form-error"}>{state.message}</div>;
}

export function ManagerAssignmentForm({ personId, currentManagerEmploymentId, managers }: { personId: string; currentManagerEmploymentId?: string; managers: ManagerOption[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setFeedback(null);
    const form = new FormData(event.currentTarget);
    const managerEmploymentId = String(form.get("managerEmploymentId") ?? "");
    try {
      const response = await fetch(`/api/people/${encodeURIComponent(personId)}/manager`, { method: "POST", headers: { "content-type": "application/json", "x-purpose": "Manager relationship administration" }, body: JSON.stringify({ managerEmploymentId: managerEmploymentId || null }) });
      const value = await response.json() as { error?: string; data?: { managerName?: string | null } };
      if (!response.ok) { setFeedback({ type: "error", message: value.error || c("Manager assignment could not be changed.","Yönetici ataması değiştirilemedi.") }); return; }
      setFeedback({ type: "success", message: value.data?.managerName ? c(`Manager changed to ${value.data.managerName}.`,`Yönetici ${value.data.managerName} olarak değiştirildi.`) : c("Manager assignment cleared.","Yönetici ataması kaldırıldı.") });
      router.refresh();
    } catch { setFeedback({ type: "error", message: c("The request could not reach HRBP.","İstek HRBP'ye ulaştırılamadı.") }); }
    finally { setSubmitting(false); }
  }

  return <div className="card employee-action-card"><div className="table-title"><div><h3>{c("Manager relationship","Yönetici ilişkisi")}</h3><p>{c("Change the effective reporting relationship with cycle prevention and audit evidence.","Raporlama ilişkisini döngü önleme ve denetim kanıtı kontrolleriyle değiştirin.")}</p></div><UserCog size={18}/></div><form className="employee-action-form" onSubmit={submit}><div className="form-field full"><label htmlFor="managerEmploymentId">{c("Manager","Yönetici")}</label><select id="managerEmploymentId" name="managerEmploymentId" defaultValue={currentManagerEmploymentId ?? ""}><option value="">{c("No manager","Yönetici yok")}</option>{managers.map((manager) => <option key={manager.employmentId} value={manager.employmentId}>{manager.name} · {manager.position}</option>)}</select></div><Feedback state={feedback}/><div className="form-actions"><button className="create-button" type="submit" disabled={submitting}><Save size={15}/>{submitting ? c("Saving…","Kaydediliyor…") : c("Update manager","Yöneticiyi güncelle")}</button></div></form></div>;
}

export function CompensationRequestForm({ personId, currency = "EUR" }: { personId: string; currency?: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setFeedback(null);
    const form = new FormData(event.currentTarget);
    const payload = { currency: String(form.get("currency") ?? "").trim().toUpperCase(), proposedAnnualBase: String(form.get("proposedAnnualBase") ?? "").trim(), effectiveDate: String(form.get("effectiveDate") ?? "").trim(), reason: String(form.get("reason") ?? "").trim() };
    try {
      const response = await fetch(`/api/people/${encodeURIComponent(personId)}/compensation`, { method: "POST", headers: { "content-type": "application/json", "x-purpose": "Compensation review" }, body: JSON.stringify(payload) });
      const value = await response.json() as { error?: string };
      if (!response.ok) { setFeedback({ type: "error", message: value.error || c("Compensation request could not be created.","Ücret değişikliği talebi oluşturulamadı.") }); return; }
      setFeedback({ type: "success", message: c("Compensation change request created and routed to approval.","Ücret değişikliği talebi oluşturuldu ve onaya yönlendirildi.") });
      event.currentTarget.reset(); router.refresh();
    } catch { setFeedback({ type: "error", message: c("The request could not reach HRBP.","İstek HRBP'ye ulaştırılamadı.") }); }
    finally { setSubmitting(false); }
  }

  return <div className="card employee-action-card"><div className="table-title"><div><h3>{c("Request compensation change","Ücret değişikliği talep et")}</h3><p>{c("Create a restricted, approval-bound change request. Salary history is not overwritten.","Kısıtlı ve onaya bağlı bir değişiklik talebi oluşturun. Ücret geçmişinin üzerine yazılmaz.")}</p></div><BadgeDollarSign size={18}/></div><form className="employee-action-form" onSubmit={submit}><div className="form-field"><label htmlFor="currency">{c("Currency","Para birimi")}</label><input id="currency" name="currency" defaultValue={currency} maxLength={3} required/></div><div className="form-field"><label htmlFor="effectiveDate">{c("Effective date","Geçerlilik tarihi")}</label><input id="effectiveDate" name="effectiveDate" type="date" required/></div><div className="form-field full"><label htmlFor="proposedAnnualBase">{c("Proposed annual base","Önerilen yıllık baz ücret")}</label><input id="proposedAnnualBase" name="proposedAnnualBase" type="number" min="0.01" step="0.01" required placeholder="75000"/></div><div className="form-field full"><label htmlFor="reason">{c("Business reason","İş gerekçesi")}</label><textarea id="reason" name="reason" rows={3} maxLength={500} placeholder={c("Annual review, promotion, market adjustment…","Yıllık değerlendirme, terfi, piyasa düzeltmesi…")}/></div><Feedback state={feedback}/><div className="form-actions"><button className="create-button" type="submit" disabled={submitting}><Save size={15}/>{submitting ? c("Submitting…","Gönderiliyor…") : c("Submit for approval","Onaya gönder")}</button></div></form></div>;
}
