"use client";

import { useEffect } from "react";

export function PolicyFocusScroller({ policyId }: { policyId?: string }) {
  useEffect(() => {
    if (!policyId) return;
    const selector = `[data-policy-id="${CSS.escape(policyId)}"]`;
    const target = document.querySelector<HTMLElement>(selector);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [policyId]);
  return null;
}
