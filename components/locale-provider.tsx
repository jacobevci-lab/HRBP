"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { isLocale, translate, type Locale, type TranslationKey } from "@/lib/i18n";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function resolveBrowserLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem("hrbp-locale");
  if (isLocale(stored)) return stored;
  const cookie = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hrbp-locale="));
  const cookieLocale = cookie?.split("=")[1];
  if (isLocale(cookieLocale)) return cookieLocale;
  return navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";
}

function persistLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dataset.locale = locale;
  window.localStorage.setItem("hrbp-locale", locale);
  document.cookie = `hrbp-locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const initial = resolveBrowserLocale();
    setLocaleState(initial);
    persistLocale(initial);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
    router.refresh();
  }, [router]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    t: (key, vars) => translate(locale, key, vars)
  }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside LocaleProvider.");
  return value;
}
