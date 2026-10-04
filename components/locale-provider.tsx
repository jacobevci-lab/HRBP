"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { isLocale, translate, type Locale, type TranslationKey } from "@/lib/i18n";
import { updateLocalePreference } from "@/lib/locale-preference-action";
import { persistClientLocale, readLocaleCookie, resolveBrowserLocale } from "@/lib/locale-preference-client";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  localePending: boolean;
  localeError: boolean;
  localePendingSeconds: number;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [localeError, setLocaleError] = useState(false);
  const [localePending, startTransition] = useTransition();
  const changing = useRef(false);
  const [pendingTicks, setPendingTicks] = useState(0);

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next) || changing.current) return;
    changing.current = true;
    setLocaleError(false);
    startTransition(async () => {
      try {
        const result = await updateLocalePreference(next);
        if (!result.ok || result.locale !== next) throw new Error("Locale was not committed.");
        // The action's cookie write refreshes server components in the same round-trip.
        // No standalone router.refresh race and no full-page reload that discards drafts.
        persistClientLocale(next);
        startTransition(() => setLocaleState(next));
      } catch {
        // Keep the previous selection; the same control can explicitly retry.
        setLocaleError(true);
      } finally {
        changing.current = false;
      }
    });
  }, []);

  useEffect(() => {
    const initial = resolveBrowserLocale();
    if (readLocaleCookie()) {
      setLocaleState(initial);
      persistClientLocale(initial);
    } else {
      // First-time browser/storage preferences must also reach server components.
      setLocale(initial);
    }
  }, [setLocale]);

  // Compatibility recovery for an observed production-only suspended router commit.
  // A bounded, ordinary progress update lets React retry the resolved transition.
  // No network retry, DOM replacement, forged readiness marker or success timeout.
  useEffect(() => {
    if (!localePending) return;
    setPendingTicks(0);
    const progress = setInterval(() => setPendingTicks((value) => value + 1), 250);
    const bound = setTimeout(() => clearInterval(progress), 5000);
    return () => { clearInterval(progress); clearTimeout(bound); };
  }, [localePending]);

  const t = useCallback((key: TranslationKey, vars?: Record<string, string | number>) =>
    translate(locale, key, vars), [locale]);
  const localePendingSeconds = Math.floor(pendingTicks / 4);
  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    localePending,
    localeError,
    localePendingSeconds,
    t
  }), [locale, setLocale, localePending, localeError, localePendingSeconds, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside LocaleProvider.");
  return value;
}
