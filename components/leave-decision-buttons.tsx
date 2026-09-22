"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";

export function LeaveDecisionButtons({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "APPROVED" | "REJECTED") {
    setBusy(decision);
    setError(null);
    try {
      const response = await fetch(`/api/leave/requests/${requestId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision })
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Leave decision failed.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Leave decision failed.");
    } finally {
      setBusy(null);
    }
  }

  return <div style={{ display: "grid", gap: 5 }}>
    <div style={{ display: "flex", gap: 6 }}>
      <button className="secondary-button" disabled={Boolean(busy)} onClick={() => decide("APPROVED")}><Check size={14}/>{busy === "APPROVED" ? "Saving…" : "Approve"}</button>
      <button className="secondary-button" disabled={Boolean(busy)} onClick={() => decide("REJECTED")}><X size={14}/>{busy === "REJECTED" ? "Saving…" : "Reject"}</button>
    </div>
    {error ? <small style={{ color: "#b42318", maxWidth: 210 }}>{error}</small> : null}
  </div>;
}
