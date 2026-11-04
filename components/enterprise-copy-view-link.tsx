"use client";

import { Check, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";

type CopyState = "idle" | "copied" | "error";

export function EnterpriseCopyViewLink({ locale, href }: { locale: Locale; href: string }) {
  const tr = locale === "tr";
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2400);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function copyViewLink() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
      const absolute = new URL(href, window.location.origin).toString();
      await navigator.clipboard.writeText(absolute);
      setState("copied");
    } catch {
      setState("error");
    }
  }

  const label = state === "copied"
    ? (tr ? "Link kopyalandı" : "Link copied")
    : state === "error"
      ? (tr ? "Kopyalanamadı" : "Copy failed")
      : (tr ? "Görünüm linkini kopyala" : "Copy view link");

  return <button
    className={`secondary-button enterprise-copy-view-link ${state}`}
    type="button"
    onClick={copyViewLink}
    title={label}
  >
    {state === "copied" ? <Check size={14}/> : <Link2 size={14}/>}
    <span aria-live="polite">{label}</span>
  </button>;
}
