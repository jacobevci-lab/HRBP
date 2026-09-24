"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldAlert } from "lucide-react";

type PayrollStatus = "DRAFT" | "VALIDATING" | "CALCULATED" | "EXCEPTION" | "APPROVAL" | "APPROVED" | "PAID" | "CANCELLED";

type PayrollAccess = {
  prepare: boolean;
  approve: boolean;
  pay: boolean;
};

const primaryNext: Partial<Record<PayrollStatus, PayrollStatus>> = {
  DRAFT: "VALIDATING",
  VALIDATING: "CALCULATED",
  CALCULATED: "APPROVAL",
  EXCEPTION: "VALIDATING",
  APPROVAL: "APPROVED",
  APPROVED: "PAID"
};

function allowed(status: PayrollStatus, access: PayrollAccess) {
  if (status === "APPROVAL") return access.approve;
  if (status === "APPROVED") return access.pay;
  if (status === "DRAFT" || status === "EXCEPTION" || status === "VALIDATING" || status === "CALCULATED") return access.prepare;
  return false;
}

function actionLabel(status: PayrollStatus) {
  if (status === "DRAFT" || status === "EXCEPTION") return "Lock & validate";
  if (status === "VALIDATING") return "Confirm calculation";
  if (status === "CALCULATED") return "Route approval";
  if (status === "APPROVAL") return "Approve payroll";
  if (status === "APPROVED") return "Mark paid";
  return "Continue";
}

const blockerLabels: Record<string, string> = {
  noResults: "missing payroll results",
  currencyMismatch: "currency mismatches",
  ledgerMismatches: "ledger mismatches",
  unlockedTimeEntries: "unlocked time entries",
  pendingLeaveRequests: "pending leave requests",
  pendingCompensationChanges: "unapplied compensation changes"
};

export function PayrollTransitionButton({ runId, status, access }: { runId: string; status: PayrollStatus; access: PayrollAccess }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = primaryNext[status];
  if (!next || !allowed(status, access)) return null;

  async function transition() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/payroll/runs/${encodeURIComponent(runId)}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Governed payroll lifecycle transition" },
        body: JSON.stringify({ status: next })
      });
      const payload = await response.json().catch(() => null) as { error?: string; blockers?: Record<string, number> } | null;
      if (!response.ok) {
        const blockers = payload?.blockers
          ? Object.entries(payload.blockers).filter(([, count]) => count > 0).map(([key, count]) => `${count} ${blockerLabels[key] ?? key}`).join(" · ")
          : "";
        throw new Error([payload?.error || "Payroll transition failed.", blockers].filter(Boolean).join(" "));
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payroll transition failed.");
    } finally {
      setBusy(false);
    }
  }

  return <div style={{ display: "grid", gap: 5 }}>
    <button className="secondary-button" disabled={busy} onClick={transition}>{busy ? "Saving…" : actionLabel(status)} <ArrowRight size={14}/></button>
    {error ? <small style={{ color: "#b42318", maxWidth: 260, display: "flex", gap: 5, alignItems: "flex-start" }}><ShieldAlert size={13} style={{ flex: "0 0 auto", marginTop: 2 }}/>{error}</small> : null}
  </div>;
}
