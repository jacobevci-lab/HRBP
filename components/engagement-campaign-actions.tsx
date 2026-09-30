"use client";

import { Archive, DoorOpen, LoaderCircle, RotateCcw, Send, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type CampaignAction = "SCHEDULE" | "OPEN" | "CLOSE" | "RETURN_DRAFT" | "ARCHIVE";

export function EngagementCampaignActions({
  campaignId,
  status,
  createdById,
  actorId,
  canWrite
}: {
  campaignId: string;
  status: string;
  createdById: string;
  actorId: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<CampaignAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const owned = createdById === actorId;

  async function transition(action: CampaignAction) {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/engagement/campaigns/${encodeURIComponent(campaignId)}/lifecycle`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Engagement campaign lifecycle" },
        body: JSON.stringify({ action })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Campaign lifecycle action failed.");
        return;
      }
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      window.dispatchEvent(new Event("hrbp:notifications-changed"));
      router.refresh();
    } catch {
      setError("Engagement service could not be reached.");
    } finally {
      setBusy(null);
    }
  }

  if (!canWrite) return null;
  if (!owned) return <span className="matrix-note">Creator action required</span>;

  return <div className="comp-decision-wrap">
    <div className="comp-decision-buttons">
      {status === "DRAFT" ? <button type="button" className="mini-action apply" disabled={!!busy} onClick={() => void transition("SCHEDULE")}>{busy === "SCHEDULE" ? <LoaderCircle size={13}/> : <Send size={13}/>} Schedule</button> : null}
      {status === "SCHEDULED" ? <button type="button" className="mini-action approve" disabled={!!busy} onClick={() => void transition("OPEN")}>{busy === "OPEN" ? <LoaderCircle size={13}/> : <DoorOpen size={13}/>} Open</button> : null}
      {status === "SCHEDULED" ? <button type="button" className="mini-action reject" disabled={!!busy} onClick={() => void transition("RETURN_DRAFT")}>{busy === "RETURN_DRAFT" ? <LoaderCircle size={13}/> : <RotateCcw size={13}/>} Draft</button> : null}
      {status === "OPEN" ? <button type="button" className="mini-action reject" disabled={!!busy} onClick={() => void transition("CLOSE")}>{busy === "CLOSE" ? <LoaderCircle size={13}/> : <XCircle size={13}/>} Close</button> : null}
      {status === "CLOSED" ? <button type="button" className="mini-action apply" disabled={!!busy} onClick={() => void transition("ARCHIVE")}>{busy === "ARCHIVE" ? <LoaderCircle size={13}/> : <Archive size={13}/>} Archive</button> : null}
    </div>
    {error ? <small className="comp-decision-error">{error}</small> : null}
  </div>;
}
