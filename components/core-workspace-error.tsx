"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useLocale } from "@/components/locale-provider";
import { coreWorkspaceCopy, type CoreWorkspaceSlug } from "@/lib/core-workspace-copy";

/** No error object, employee data, demo records or mutation controls cross this boundary. */
function CoreWorkspaceErrorContent({ slug }: { slug: CoreWorkspaceSlug }) {
  const { locale } = useLocale();
  const { title } = coreWorkspaceCopy(slug, locale);
  const reloading = useRef(false);
  const [pending, setPending] = useState(false);
  function retry() {
    if (reloading.current) return;
    reloading.current = true;
    setPending(true);
    // Explicitly reload this GET page; do not replay a submitted API write.
    window.location.reload();
  }
  return <section className="card module-table" data-core-workspace-state="unavailable" data-core-workspace={slug}>
    <div className="empty-state" role="alert">
      <h1>{locale === "tr" ? `${title} şu anda yüklenemiyor` : `${title} is temporarily unavailable`}</h1>
      <p>{locale === "tr"
        ? "Bu sayfanın verileri yüklenemedi. Canlı kayıtların yerine örnek veri veya sıfır toplam gösterilmiyor. Bu hata görünümünde kayıt oluşturma ve değişiklik kontrolleri sunulmaz."
        : "This page could not load its data. Live records are not replaced with sample data or zero totals. This error view does not offer record creation or mutation controls."}</p>
      <p>{locale === "tr"
        ? "Yeniden yükleme mevcut adresi ve URL filtrelerini korur; kaydedilmemiş form verileri korunmaz."
        : "Reloading preserves the current address and URL filters; unsaved form data is not preserved."}</p>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
        <button className="secondary-button" type="button" onClick={retry} disabled={pending} aria-busy={pending}>
          {pending ? (locale === "tr" ? "Yeniden yükleniyor…" : "Reloading…") : (locale === "tr" ? "Yeniden yükle" : "Reload page")}
        </button>
        {slug === "employee-360" ? <Link className="secondary-button" href="/module/people">
          {locale === "tr" ? "Çalışan dizinine dön" : "Return to People"}
        </Link> : null}
        <Link className="secondary-button" href="/">{locale === "tr" ? "Ana sayfaya dön" : "Return to Command Center"}</Link>
      </div>
    </div>
  </section>;
}

export function CoreWorkspaceError({ slug }: { slug: CoreWorkspaceSlug }) {
  // AppShell owns LocaleProvider. Consumers must render BELOW that provider.
  return <AppShell><CoreWorkspaceErrorContent slug={slug}/></AppShell>;
}
