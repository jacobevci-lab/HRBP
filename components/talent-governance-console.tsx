"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Award, CheckCircle2, CircleAlert, ShieldCheck, Sparkles } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { TalentGovernanceData } from "@/lib/talent-governance-data";

const performanceBands = ["NEEDS_IMPROVEMENT", "DEVELOPING", "MEETS", "EXCEEDS", "OUTSTANDING"];
const potentialBands = ["LIMITED", "MODERATE", "HIGH"];

function label(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = {
    NEEDS_IMPROVEMENT: "Gelişim gerekli",
    DEVELOPING: "Gelişiyor",
    MEETS: "Beklentiyi karşılıyor",
    EXCEEDS: "Beklentiyi aşıyor",
    OUTSTANDING: "Üstün",
    LIMITED: "Sınırlı",
    MODERATE: "Orta",
    HIGH: "Yüksek"
  };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function dateTime(value: string, locale: "en" | "tr") {
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function TalentGovernanceConsole({ cycleLabels, rows }: TalentGovernanceData) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [cycle, setCycle] = useState(cycleLabels[0] ?? "ALL");
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const visible = useMemo(() => cycle === "ALL" ? rows : rows.filter((row) => row.cycleLabel === cycle), [cycle, rows]);

  async function save(id: string, payload: Record<string, unknown>) {
    setPending(id);
    setNotice(null);
    try {
      const response = await fetch(`/api/talent/assessments/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`, `İstek başarısız (${response.status})`));
      setNotice({ tone: "ok", text: c("Human assessment corrected and audit evidence written.", "İnsan değerlendirmesi düzeltildi ve denetim kanıtı yazıldı.") });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Transaction failed.", "İşlem başarısız.") });
    } finally {
      setPending(null);
    }
  }

  return <section className="performance-console card growth-lifecycle-console">
    <div className="performance-console-head">
      <div><span className="section-kicker">{c("Talent governance", "Yetenek yönetişimi")}</span><h3>{c("Human assessment register", "İnsan değerlendirme kayıtları")}</h3><p>{c("Review and correct explicit performance, potential and critical-talent decisions without introducing an opaque employee score. Every correction refreshes the assessor identity and audit trail.", "Opak çalışan skoru oluşturmadan açık performans, potansiyel ve kritik-yetenek kararlarını inceleyin ve düzeltin. Her düzeltme değerlendirici kimliğini ve denetim izini yeniler.")}</p></div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Human decision boundary", "İnsan karar sınırı")}</span></div>
    </div>

    {notice ? <div className={`performance-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}

    <div className="performance-panel-title" style={{ marginBottom: 12 }}>
      <Sparkles size={16}/><div><strong>{c("Assessment cycle", "Değerlendirme döngüsü")}</strong><small>{c(`${visible.length} governed records`, `${visible.length} yönetişimli kayıt`)}</small></div>
      <select value={cycle} onChange={(event) => setCycle(event.target.value)} aria-label={c("Assessment cycle", "Değerlendirme döngüsü")}>
        <option value="ALL">{c("All cycles", "Tüm döngüler")}</option>
        {cycleLabels.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    </div>

    <div className="growth-lifecycle-list">{visible.length ? visible.map((row) => <form className="growth-lifecycle-row" key={row.id} onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void save(row.id, {
        performance: data.get("performance"),
        potential: data.get("potential"),
        criticalTalent: data.get("criticalTalent") === "on",
        notes: data.get("notes") || null
      });
    }}>
      <div className="growth-lifecycle-icon"><Award size={16}/></div>
      <div className="growth-lifecycle-copy"><strong>{row.person}</strong><small>{row.employeeNumber} · {row.position} · {row.organization}</small><span>{row.cycleLabel} · {c("Assessed by", "Değerlendiren")} {row.assessor} · {dateTime(row.assessedAt, locale)}</span></div>
      <div className="performance-review-controls">
        <select name="performance" defaultValue={row.performance}>{performanceBands.map((value) => <option key={value} value={value}>{label(value, locale)}</option>)}</select>
        <select name="potential" defaultValue={row.potential}>{potentialBands.map((value) => <option key={value} value={value}>{label(value, locale)}</option>)}</select>
        <label className="growth-check"><input name="criticalTalent" type="checkbox" defaultChecked={row.criticalTalent}/> {c("Critical", "Kritik")}</label>
        <input name="notes" maxLength={4000} defaultValue={row.notes ?? ""} placeholder={c("Assessment notes", "Değerlendirme notları")}/>
        <button className="secondary-button" disabled={pending !== null}>{pending === row.id ? "…" : c("Save correction", "Düzeltmeyi kaydet")}</button>
      </div>
    </form>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No talent assessments are available in your authorized scope.", "Yetkili kapsamınızda yetenek değerlendirmesi yok.")}</span></div>}</div>
  </section>;
}
