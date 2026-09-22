"use client";

import Link from "next/link";
import { CircleAlert, House, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [tr, setTr] = useState(false);
  useEffect(() => {
    console.error("HRBP application render failure", error);
    setTr(document.documentElement.lang === "tr" || document.documentElement.dataset.locale === "tr");
  }, [error]);
  const c = (en: string, trValue: string) => tr ? trValue : en;

  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--bg)", color: "var(--text)" }}><section className="card" style={{ width: "min(680px, 100%)", padding: 28 }}><div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}><div className="enterprise-stat-icon"><CircleAlert size={19}/></div><div style={{ flex: 1 }}><div className="section-kicker">{c("HRBP One recovery","HRBP One kurtarma")}</div><h2 style={{ margin: "4px 0 8px" }}>{c("The current workspace could not be rendered.","Mevcut çalışma alanı görüntülenemedi.")}</h2><p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6, fontSize: 11 }}>{c("Retry the request. If the live data plane is unavailable, supported modules automatically switch to a safe staging view instead of taking down navigation.","İsteği yeniden deneyin. Canlı veri düzlemi kullanılamıyorsa desteklenen modüller navigasyonu kapatmak yerine otomatik olarak güvenli staging görünümüne geçer.")}</p>{error.digest ? <p style={{ margin: "10px 0 0", color: "var(--muted-2)", fontSize: 9 }}>{c("Diagnostic digest","Tanılama özeti")}: {error.digest}</p> : null}<div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}><button className="create-button" type="button" onClick={() => reset()}><RotateCcw size={16}/> {c("Retry","Tekrar dene")}</button><Link className="secondary-button" href="/"><House size={15}/> {c("Command Center","Komuta Merkezi")}</Link></div></div></div></section></main>;
}
