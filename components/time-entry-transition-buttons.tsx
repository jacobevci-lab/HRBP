"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, LockKeyhole, RotateCcw, X } from "lucide-react";

type TimeStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "LOCKED";

function label(status: TimeStatus) {
  if (status === "SUBMITTED") return "Submit";
  if (status === "APPROVED") return "Approve";
  if (status === "REJECTED") return "Reject";
  if (status === "LOCKED") return "Lock";
  return "Return to draft";
}

function Icon({ status }: { status: TimeStatus }) {
  if (status === "APPROVED") return <Check size={13}/>;
  if (status === "REJECTED") return <X size={13}/>;
  if (status === "LOCKED") return <LockKeyhole size={13}/>;
  if (status === "DRAFT") return <RotateCcw size={13}/>;
  return <ArrowRight size={13}/>;
}

export function TimeEntryTransitionButtons({ entryId, targets }: { entryId: string; targets: TimeStatus[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<TimeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!targets.length) return <span style={{ color: "var(--muted)" }}>—</span>;

  async function transition(status: TimeStatus) {
    setBusy(status);
    setError(null);
    try {
      const response = await fetch(`/api/time/entries/${entryId}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status })
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Time-entry transition failed.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Time-entry transition failed.");
    } finally {
      setBusy(null);
    }
  }

  return <div style={{ display: "grid", gap: 5, minWidth: 112 }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
      {targets.map((status) => <button key={status} className="secondary-button" disabled={Boolean(busy)} onClick={() => transition(status)}>{busy === status ? "Saving…" : label(status)} <Icon status={status}/></button>)}
    </div>
    {error ? <small style={{ color: "#b42318", maxWidth: 220 }}>{error}</small> : null}
  </div>;
}
