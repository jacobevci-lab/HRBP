"use client";

import { useEffect } from "react";

export function GovernedFocusScroller({ attribute, value }: { attribute: string; value?: string }) {
  useEffect(() => {
    if (!value || !/^[a-z0-9-]+$/i.test(attribute)) return;
    const selector = `[${attribute}="${CSS.escape(value)}"]`;
    const target = document.querySelector<HTMLElement>(selector);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [attribute, value]);
  return null;
}
