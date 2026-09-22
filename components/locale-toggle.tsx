"use client";

import { Languages } from "lucide-react";
import { useLocale } from "@/components/locale-provider";

export function LocaleToggle() {
  const { locale, setLocale, t } = useLocale();

  return (
    <div className="locale-toggle" role="group" aria-label="Language">
      <Languages size={15}/>
      <button
        type="button"
        className={locale === "tr" ? "active" : ""}
        onClick={() => setLocale("tr")}
        aria-pressed={locale === "tr"}
        title={t("locale.turkish")}
      >TR</button>
      <span>/</span>
      <button
        type="button"
        className={locale === "en" ? "active" : ""}
        onClick={() => setLocale("en")}
        aria-pressed={locale === "en"}
        title={t("locale.english")}
      >EN</button>
    </div>
  );
}
