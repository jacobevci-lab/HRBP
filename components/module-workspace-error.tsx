"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useLocale } from "@/components/locale-provider";

/** Replaces the entire failed generic route, including sibling mutation panels.
 * Error objects, URL values and synthetic business data are never rendered here. */
function ModuleWorkspaceErrorContent() {
  const { locale } = useLocale();
  const reloading = useRef(false);
  const [pending, setPending] = useState(false);
  function reload() {
    if (reloading.current) return;
    reloading.current = true;
    setPending(true);
    // The generic module route is a GET page. This reload is explicit, never a
    // background retry or a replay of an API write. Unsaved drafts are not kept.
    window.location.reload();
  }
  return <>
    <section className="card module-table" data-module-workspace-state="unavailable">
      <div className="empty-state" role="alert">
        <h1>{locale === "tr" ? "Çalışma alanı şu anda yüklenemiyor" : "This workspace is temporarily unavailable"}</h1>
        <p>{locale === "tr"
          ? "Canlı görünüm tamamlanamadı. Gerçek kayıtların yerine örnek veriler veya sıfır toplamlar gösterilmiyor. Bu hata ekranında kayıt oluşturma ve değişiklik kontrolleri bulunmaz."
          : "The live view could not finish loading. Real records are not replaced with sample data or zero totals. This error screen contains no record creation or mutation controls."}</p>
        <p>{locale === "tr"
          ? "Yeniden yükleme mevcut adresi ve URL filtrelerini korur; kaydedilmemiş form verileri korunmaz. Daha önce gönderdiğiniz bir işlemin sonucu belirsizse, tekrar göndermeden önce kaydı kontrol edin."
          : "Reload preserves the current address and URL filters, not unsaved form data. When an earlier submitted operation has an unknown outcome, check the record before sending it again."}</p>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
          <button className="secondary-button" type="button" onClick={reload} disabled={pending} aria-busy={pending}>
            {pending ? (locale === "tr" ? "Yeniden yükleniyor…" : "Reloading…") : (locale === "tr" ? "Yeniden yükle" : "Reload page")}
          </button>
          <Link className="secondary-button" href="/">{locale === "tr" ? "Ana sayfaya dön" : "Return to Command Center"}</Link>
        </div>
      </div>
    </section>
  </>;
}

export function ModuleWorkspaceError() {
  // AppShell owns LocaleProvider; the error boundary is outside the failed page.
  return <AppShell><ModuleWorkspaceErrorContent/></AppShell>;
}
