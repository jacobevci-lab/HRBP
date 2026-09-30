"use client";

import { CheckCircle2, LoaderCircle, Pause, Play, ShieldCheck, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type DSRAction = "BEGIN_VERIFICATION" | "VERIFY" | "WAIT" | "RESUME" | "COMPLETE" | "REJECT" | "CANCEL";

export function DSRLifecycleActions({
  dsrId,
  status,
  ownerId,
  actorId,
  canWrite
}: {
  dsrId: string;
  status: string;
  ownerId: string | null;
  actorId: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<DSRAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ownerBound = Boolean(ownerId && ownerId === actorId);

  async function transition(action: DSRAction) {
    let reason: string | undefined;
    if (action === "REJECT") {
      const value = window.prompt("Rejection reason");
      if (!value?.trim()) return;
      reason = value.trim();
    }
    if (action === "CANCEL" && !window.confirm("Cancel this DSR?")) return;

    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/privacy/dsrs/${encodeURIComponent(dsrId)}/lifecycle`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "DSR lifecycle operation" },
        body: JSON.stringify({ action, reason })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "DSR lifecycle action failed.");
        return;
      }
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      window.dispatchEvent(new Event("hrbp:notifications-changed"));
      router.refresh();
    } catch {
      setError("Privacy service could not be reached.");
    } finally {
      setBusy(null);
    }
  }

  if (!canWrite) return null;
  if (!ownerBound) return <span className="matrix-note">Owner action required</span>;

  return <div className="comp-decision-wrap">
    <div className="comp-decision-buttons">
      {status === "RECEIVED" ? <button type="button" className="mini-action approve" disabled={!!busy} onClick={() => void transition("BEGIN_VERIFICATION")}>{busy === "BEGIN_VERIFICATION" ? <LoaderCircle size={13}/> : <ShieldCheck size={13}/>} Begin verification</button> : null}
      {status === "IDENTITY_VERIFICATION" ? <button type="button" className="mini-action apply" disabled={!!busy} onClick={() => void transition("VERIFY")}>{busy === "VERIFY" ? <LoaderCircle size={13}/> : <Play size={13}/>} Verify & start</button> : null}
      {status === "IN_PROGRESS" ? <button type="button" className="mini-action reject" disabled={!!busy} onClick={() => void transition("WAIT")}>{busy === "WAIT" ? <LoaderCircle size={13}/> : <Pause size={13}/>} Wait</button> : null}
      {status === "WAITING" ? <button type="button" className="mini-action apply" disabled={!!busy} onClick={() => void transition("RESUME")}>{busy === "RESUME" ? <LoaderCircle size={13}/> : <Play size={13}/>} Resume</button> : null}
      {(status === "IN_PROGRESS" || status === "WAITING") ? <button type="button" className="mini-action approve" disabled={!!busy} onClick={() => void transition("COMPLETE")}>{busy === "COMPLETE" ? <LoaderCircle size={13}/> : <CheckCircle2 size={13}/>} Complete</button> : null}
      {!["COMPLETED", "REJECTED", "CANCELLED"].includes(status) ? <button type="button" className="mini-action reject" disabled={!!busy} onClick={() => void transition("REJECT")}>{busy === "REJECT" ? <LoaderCircle size={13}/> : <XCircle size={13}/>} Reject</button> : null}
      {!["COMPLETED", "REJECTED", "CANCELLED"].includes(status) ? <button type="button" className="mini-action reject" disabled={!!busy} onClick={() => void transition("CANCEL")}>{busy === "CANCEL" ? <LoaderCircle size={13}/> : <XCircle size={13}/>} Cancel</button> : null}
    </div>
    {error ? <small className="comp-decision-error">{error}</small> : null}
  </div>;
}
