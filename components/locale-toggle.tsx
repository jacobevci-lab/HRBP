"use client";

import { Languages } from "lucide-react";
import { useLocale } from "@/components/locale-provider";

export function LocaleToggle() {
  const { locale, setLocale, localePending, localeError, t } = useLocale();

  return (
    <div className="locale-toggle" role="group" aria-label={locale === "tr" ? "Dil" : "Language"} aria-busy={localePending}>
      <Languages size={15}/>
      <button
        type="button"
        disabled={localePending}
        className={locale === "tr" ? "active" : ""}
        onClick={() => setLocale("tr")}
        aria-pressed={locale === "tr"}
        title={t("locale.turkish")}
      >TR</button>
      <span>/</span>
      <button
        type="button"
        disabled={localePending}
        className={locale === "en" ? "active" : ""}
        onClick={() => setLocale("en")}
        aria-pressed={locale === "en"}
        title={t("locale.english")}
      >EN</button>
      {localeError ? <small className="locale-error" role="alert">{locale === "tr"
        ? "Dil değiştirilemedi. Yeniden deneyin."
        : "Language could not be changed. Please retry."}</small> : null}
    </div>
  );
}
