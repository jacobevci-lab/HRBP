"use client";

import { Check, LockKeyhole, LoaderCircle, RotateCcw, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function WorkforceScenarioActions({
  scenarioId,
  status,
  ownerId,
  actorId,
  canWrite,
  canApprove
}: {
  scenarioId: string;
  status: string;
  ownerId: string;
  actorId: string;
  canWrite: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = ownerId === actorId;

  async function transition(action: "SUBMIT" | "APPROVE" | "REQUEST_CHANGES" | "LOCK") {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/workforce-planning/scenarios/${encodeURIComponent(scenarioId)}/review`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Workforce planning governance" },
        body: JSON.stringify({ action })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Scenario governance action failed.");
        return;
      }
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      window.dispatchEvent(new Event("hrbp:notifications-changed"));
      router.refresh();
    } catch {
      setError("Workforce planning service could not be reached.");
    } finally {
      setBusy(null);
    }
  }

  return <div className="comp-decision-wrap">
    <div className="comp-decision-buttons">
      {status === "DRAFT" && canWrite ? <button type="button" className="mini-action apply" disabled={!!busy} onClick={() => void transition("SUBMIT")}>{busy === "SUBMIT" ? <LoaderCircle size={13}/> : <Send size={13}/>} Submit</button> : null}
      {status === "REVIEW" && canApprove && !isOwner ? <button type="button" className="mini-action approve" disabled={!!busy} onClick={() => void transition("APPROVE")}>{busy === "APPROVE" ? <LoaderCircle size={13}/> : <Check size={13}/>} Approve</button> : null}
      {(status === "REVIEW" || status === "APPROVED") && canApprove ? <button type="button" className="mini-action reject" disabled={!!busy} onClick={() => void transition("REQUEST_CHANGES")}>{busy === "REQUEST_CHANGES" ? <LoaderCircle size={13}/> : <RotateCcw size={13}/>} Changes</button> : null}
      {status === "APPROVED" && canWrite ? <button type="button" className="mini-action apply" disabled={!!busy} onClick={() => void transition("LOCK")}>{busy === "LOCK" ? <LoaderCircle size={13}/> : <LockKeyhole size={13}/>} Lock</button> : null}
    </div>
    {status === "REVIEW" && canApprove && isOwner ? <small className="comp-decision-error">Four-eyes: the scenario owner cannot approve this plan.</small> : null}
    {error ? <small className="comp-decision-error">{error}</small> : null}
  </div>;
}
