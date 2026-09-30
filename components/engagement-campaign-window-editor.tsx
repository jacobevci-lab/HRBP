"use client";

import { CalendarClock, LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

function toLocalInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function EngagementCampaignWindowEditor({
  campaignId,
  status,
  createdById,
  actorId,
  canWrite,
  opensAt,
  closesAt
}: {
  campaignId: string;
  status: string;
  createdById: string;
  actorId: string;
  canWrite: boolean;
  opensAt?: string | null;
  closesAt?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [openValue, setOpenValue] = useState(() => toLocalInput(opensAt));
  const [closeValue, setCloseValue] = useState(() => toLocalInput(closesAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canWrite || createdById !== actorId || status !== "DRAFT") return null;

  async function save() {
    if (!openValue || !closeValue) {
      setError("Open and close dates are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/engagement/campaigns/${encodeURIComponent(campaignId)}/window`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-purpose": "Engagement campaign scheduling window" },
        body: JSON.stringify({
          opensAt: new Date(openValue).toISOString(),
          closesAt: new Date(closeValue).toISOString()
        })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || "Campaign window update failed.");
        return;
      }
      setOpen(false);
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      router.refresh();
    } catch {
      setError("Engagement service could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  return <div style={{ display: "grid", gap: 5 }}>
    <button type="button" className="secondary-button" onClick={() => setOpen((value) => !value)}><CalendarClock size={12}/> Window</button>
    {open ? <div className="card" style={{ padding: 9, display: "grid", gap: 6, minWidth: 230 }}>
      <label style={{ display: "grid", gap: 3 }}><small>Opens</small><input type="datetime-local" value={openValue} onChange={(event) => setOpenValue(event.target.value)}/></label>
      <label style={{ display: "grid", gap: 3 }}><small>Closes</small><input type="datetime-local" value={closeValue} onChange={(event) => setCloseValue(event.target.value)}/></label>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void save()}>{busy ? <LoaderCircle size={12}/> : <Save size={12}/>} Save window</button>
      {error ? <small className="comp-decision-error">{error}</small> : null}
    </div> : null}
  </div>;
}
