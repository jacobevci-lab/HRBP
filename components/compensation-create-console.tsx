"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeDollarSign, CheckCircle2, CircleAlert, ShieldCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { CompensationEligibleEmployment } from "@/lib/compensation-live-data";

function money(locale: "en" | "tr", currency: string | null, amount: string | null) {
  if (!currency || !amount) return locale === "tr" ? "Aktif maaş kaydı yok" : "No active salary record";
  try {
    return new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(amount));
  } catch {
    return `${currency} ${Number(amount).toLocaleString(locale === "tr" ? "tr-TR" : "en-US")}`;
  }
}

export function CompensationCreateConsole({ employments }: { employments: CompensationEligibleEmployment[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [employmentId, setEmploymentId] = useState("");
  const selected = useMemo(() => employments.find((item) => item.id === employmentId) ?? null, [employments, employmentId]);
  const [currency, setCurrency] = useState("TRY");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  return <section className="performance-console card" style={{ marginBottom: 14 }}>
    <div className="performance-console-head">
      <div><span className="section-kicker">{c("Restricted proposal", "Kısıtlı teklif")}</span><h3>{c("Create compensation change draft", "Ücret değişikliği taslağı oluştur")}</h3><p>{c("The salary baseline is resolved again on the server for the requested effective date. The browser cannot supply or overwrite the current salary snapshot.", "Maaş baz değeri istenen geçerlilik tarihi için sunucuda yeniden çözülür. Tarayıcı mevcut maaş snapshot'ını gönderemez veya üzerine yazamaz.")}</p></div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Four-eyes workflow", "Dört göz iş akışı")}</span></div>
    </div>

    {notice ? <div className={`performance-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}

    <form className="performance-form" style={{ maxWidth: "none" }} onSubmit={async (event) => {
      event.preventDefault();
      setPending(true);
      setNotice(null);
      const form = event.currentTarget;
      const values = new FormData(form);
      try {
        const response = await fetch("/api/compensation/changes", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-purpose": "Compensation proposal" },
          body: JSON.stringify({
            employmentId,
            currency,
            proposedAnnualBase: values.get("proposedAnnualBase"),
            effectiveAt: values.get("effectiveAt"),
            reason: values.get("reason")
          })
        });
        const payload = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(payload.error || c("Compensation draft could not be created.", "Ücret değişikliği taslağı oluşturulamadı."));
        setNotice({ tone: "ok", text: c("Draft created. Review the queue and submit it for independent approval.", "Taslak oluşturuldu. Kuyruktan kontrol edip bağımsız onaya gönderin.") });
        form.reset();
        setEmploymentId("");
        setCurrency("TRY");
        router.refresh();
      } catch (error) {
        setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Compensation draft could not be created.", "Ücret değişikliği taslağı oluşturulamadı.") });
      } finally {
        setPending(false);
      }
    }}>
      <div className="performance-form-title"><BadgeDollarSign size={17}/><div><strong>{c("Salary proposal", "Maaş teklifi")}</strong><small>{c("Draft → independent approval → effective-dated apply → payroll handoff", "Taslak → bağımsız onay → tarih-etkin uygulama → bordro devri")}</small></div></div>
      <div className="performance-form-row">
        <label>{c("Employee", "Çalışan")}<select required value={employmentId} onChange={(event) => {
          const nextId = event.target.value;
          setEmploymentId(nextId);
          const next = employments.find((item) => item.id === nextId);
          if (next?.currency) setCurrency(next.currency);
        }}><option value="" disabled>{c("Select employment", "Çalışan seçin")}</option>{employments.map((employment) => <option key={employment.id} value={employment.id}>{employment.employeeNumber} · {employment.employee} · {employment.position}</option>)}</select></label>
        <label>{c("Currency", "Para birimi")}<input required name="currency" value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))}/></label>
      </div>
      <div className="performance-form-row">
        <label>{c("Proposed annual base", "Önerilen yıllık baz ücret")}<input name="proposedAnnualBase" type="number" min="0.01" step="0.01" required/></label>
        <label>{c("Effective date", "Geçerlilik tarihi")}<input name="effectiveAt" type="date" required/></label>
      </div>
      <label>{c("Business reason", "İş gerekçesi")}<textarea name="reason" minLength={3} maxLength={500} rows={3} required/></label>
      <div className="mini-rule"><span>{c("Current governed salary", "Mevcut yönetişimli maaş")}</span><strong>{selected ? money(locale, selected.currency, selected.currentAnnualBase) : c("Select an employee", "Çalışan seçin")}</strong></div>
      {selected ? <div className="mini-rule"><span>{c("Employment context", "İstihdam bağlamı")}</span><strong>{selected.organization} · {selected.position}</strong></div> : null}
      <button className="create-button" disabled={pending || !employmentId || currency.length !== 3 || !employments.length}>{pending ? c("Creating draft…", "Taslak oluşturuluyor…") : c("Create governed draft", "Yönetişimli taslak oluştur")}</button>
    </form>
  </section>;
}
