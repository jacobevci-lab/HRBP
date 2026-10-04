"use server";

import { cookies } from "next/headers";
import { isLocale, type Locale } from "@/lib/i18n";

/** One server action commits the cookie and returns the refreshed server tree.
 * Next's Server Action origin checks apply; this changes only a UI preference.
 */
export async function updateLocalePreference(value: unknown): Promise<
  { ok: true; locale: Locale } | { ok: false }
> {
  if (!isLocale(value)) return { ok: false };
  const store = await cookies();
  store.set("hrbp-locale", value, { path: "/", maxAge: 31536000, sameSite: "lax" });
  return { ok: true, locale: value };
}
