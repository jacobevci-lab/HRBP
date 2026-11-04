"use client";

import { Check, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";

type CopyState = "idle" | "copied" | "error";

function legacyCopy(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }
  return copied;
}

export function EnterpriseCopyViewLink({ locale, href }: { locale: Locale; href: string }) {
  const tr = locale === "tr";
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    setState("idle");
  }, [href]);

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2400);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function copyViewLink() {
    try {
      const absolute = new URL(href, window.location.origin).toString();
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(absolute);
      } else if (!legacyCopy(absolute)) {
        throw new Error("CLIPBOARD_UNAVAILABLE");
      }
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
