"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

type PayrollStatus = "DRAFT" | "VALIDATING" | "CALCULATED" | "EXCEPTION" | "APPROVAL" | "APPROVED" | "PAID" | "CANCELLED";

const primaryNext: Partial<Record<PayrollStatus, PayrollStatus>> = {
  DRAFT: "VALIDATING",
  VALIDATING: "CALCULATED",
  CALCULATED: "APPROVAL",
  EXCEPTION: "VALIDATING",
  APPROVAL: "APPROVED",
  APPROVED: "PAID"
};

function label(status: PayrollStatus) {
  return status.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export function PayrollTransitionButton({ runId, status }: { runId: string; status: PayrollStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = primaryNext[status];
  if (!next) return null;

  async function transition() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/payroll/runs/${runId}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next })
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Payroll transition failed.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payroll transition failed.");
    } finally {
      setBusy(false);
    }
  }

  return <div style={{ display: "grid", gap: 5 }}>
    <button className="secondary-button" disabled={busy} onClick={transition}>{busy ? "Saving…" : label(next)} <ArrowRight size={14}/></button>
    {error ? <small style={{ color: "#b42318", maxWidth: 220 }}>{error}</small> : null}
  </div>;
}
