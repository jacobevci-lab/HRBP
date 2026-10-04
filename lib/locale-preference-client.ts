import { isLocale, type Locale } from "@/lib/i18n";

export function readLocaleCookie(): Locale | undefined {
  if (typeof document === "undefined") return undefined;
  const value = document.cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("hrbp-locale="))?.slice("hrbp-locale=".length);
  return isLocale(value) ? value : undefined;
}

/** The committed cookie is also what server components read. Storage is a fallback. */
export function resolveBrowserLocale(): Locale {
  const cookie = readLocaleCookie();
  if (cookie) return cookie;
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem("hrbp-locale");
    if (isLocale(stored)) return stored;
  } catch { /* Storage can be unavailable in a privacy-restricted browser. */ }
  return navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";
}

/** Do not independently write the cookie: the server action owns its commit. */
export function persistClientLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dataset.locale = locale;
  try { window.localStorage.setItem("hrbp-locale", locale); } catch { /* Cookie still persists the preference. */ }
}
