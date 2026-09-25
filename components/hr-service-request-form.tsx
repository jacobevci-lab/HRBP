"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }

export function HRServiceRequestForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/hr-service/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, subcategory, title, description, priority })
      });
      const body = await response.json().catch(() => ({})) as { error?: string; data?: { requestNumber?: string } };
      if (!response.ok) throw new Error(body.error ?? "Request could not be created.");
      setCategory(""); setSubcategory(""); setTitle(""); setDescription(""); setPriority("MEDIUM");
      setMessage(c(locale, `Request ${body.data?.requestNumber ?? ""} created.`, `Talep ${body.data?.requestNumber ?? ""} oluşturuldu.`));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : c(locale, "Request could not be created.", "Talep oluşturulamadı."));
    } finally { setBusy(false); }
  }

  return <details>
    <summary style={{ cursor: "pointer", fontWeight: 700 }}>{c(locale, "Create HR service request", "İK hizmet talebi oluştur")}</summary>
    <form onSubmit={submit} style={{ display: "grid", gap: 9, marginTop: 12, maxWidth: 760 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 9 }}>
        <input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={80} required placeholder={c(locale, "Category", "Kategori")}/>
        <input value={subcategory} onChange={(event) => setSubcategory(event.target.value)} maxLength={80} placeholder={c(locale, "Subcategory (optional)", "Alt kategori (opsiyonel)")}/>
        <select value={priority} onChange={(event) => setPriority(event.target.value)}>
          <option value="LOW">{c(locale, "Low", "Düşük")}</option>
          <option value="MEDIUM">{c(locale, "Medium", "Orta")}</option>
          <option value="HIGH">{c(locale, "High", "Yüksek")}</option>
          <option value="CRITICAL">{c(locale, "Critical", "Kritik")}</option>
        </select>
      </div>
      <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required placeholder={c(locale, "Request title", "Talep başlığı")}/>
      <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} required rows={4} placeholder={c(locale, "Describe what you need and the relevant context", "İhtiyacınızı ve ilgili bağlamı açıklayın")}/>
      <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" disabled={busy}>{busy ? c(locale, "Creating…", "Oluşturuluyor…") : c(locale, "Create request", "Talep oluştur")}</button>
        {message ? <small aria-live="polite">{message}</small> : null}
      </div>
    </form>
  </details>;
}
