"use client";

import { Check, LoaderCircle, Play, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CompensationDecisionButtons({ changeId, status }: { changeId: string; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "APPROVE" | "REJECT" | "APPLY") {
    setLoading(decision);
    setError(null);
    try {
      const response = await fetch(`/api/compensation/changes/${encodeURIComponent(changeId)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Compensation approval workflow" },
        body: JSON.stringify({ decision })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Compensation decision could not be completed.");
        return;
      }
      router.refresh();
    } catch {
      setError("The request could not reach HRBP.");
    } finally {
      setLoading(null);
    }
  }

  return <div className="comp-decision-wrap">
    {status === "APPROVAL" ? <div className="comp-decision-buttons"><button type="button" className="mini-action approve" onClick={() => decide("APPROVE")} disabled={!!loading}>{loading === "APPROVE" ? <LoaderCircle size={13}/> : <Check size={13}/>} Approve</button><button type="button" className="mini-action reject" onClick={() => decide("REJECT")} disabled={!!loading}>{loading === "REJECT" ? <LoaderCircle size={13}/> : <X size={13}/>} Reject</button></div> : null}
    {status === "APPROVED" ? <button type="button" className="mini-action apply" onClick={() => decide("APPLY")} disabled={!!loading}>{loading === "APPLY" ? <LoaderCircle size={13}/> : <Play size={13}/>} Apply</button> : null}
    {error ? <small className="comp-decision-error">{error}</small> : null}
  </div>;
}
