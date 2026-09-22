import { cookies } from "next/headers";
import { isLocale, type Locale } from "@/lib/i18n";

export async function getServerLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get("hrbp-locale")?.value;
  return isLocale(value) ? value : "en";
}
