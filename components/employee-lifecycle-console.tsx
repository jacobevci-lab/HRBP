"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, BadgeCheck, BriefcaseBusiness, CircleAlert, ExternalLink, ShieldCheck, TrendingUp } from "lucide-react";

interface PositionOption {
  id: string;
  positionCode: string;
  title: string;
  status: string;
  location: string | null;
  orgUnit?: { name: string } | null;
}

type Notice = { kind: "ok" | "error"; message: string } | null;

export function EmployeeLifecycleConsole({
  personId,
  employeeName,
  currentPosition,
  currentDepartment,
  canMove,
  canOffboard
}: {
  personId: string;
  employeeName: string;
  currentPosition: string;
  currentDepartment: string;
  canMove: boolean;
  canOffboard: boolean;
}) {
  const router = useRouter();
  const [positions, setPositions] = useState<PositionOption[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(canMove);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [eventType, setEventType] = useState<"TRANSFERRED" | "PROMOTED">("TRANSFERRED");
  const [targetPositionId, setTargetPositionId] = useState("");
  const [effectiveAt, setEffectiveAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!canMove) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/positions", { cache: "no-store" });
        const payload = await response.json() as { data?: PositionOption[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Positions could not be loaded.");
        if (!cancelled) setPositions((payload.data ?? []).filter((position) => position.status === "OPEN"));
      } catch (error) {
        if (!cancelled) setNotice({ kind: "error", message: error instanceof Error ? error.message : "Positions could not be loaded." });
      } finally {
        if (!cancelled) setLoadingPositions(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canMove]);

  const selected = useMemo(() => positions.find((position) => position.id === targetPositionId), [positions, targetPositionId]);

  async function submitPositionChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetPositionId) {
      setNotice({ kind: "error", message: "Select an open target position." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/people/${encodeURIComponent(personId)}/lifecycle/position`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetPositionId, eventType, effectiveAt, reason })
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Lifecycle change failed.");
      setNotice({ kind: "ok", message: `${eventType === "PROMOTED" ? "Promotion" : "Transfer"} completed and written to the lifecycle ledger.` });
      setTargetPositionId("");
      setReason("");
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Lifecycle change failed." });
    } finally {
      setBusy(false);
    }
  }

  return <div className="lifecycle-console-stack">
    <section className="card lifecycle-command-card">
      <div className="lifecycle-command-head">
        <div><span className="section-kicker">Governed lifecycle command</span><h2>{employeeName}</h2><p>{currentPosition} · {currentDepartment}</p></div>
        <div className="lifecycle-command-health"><ShieldCheck size={16}/><span>RBAC + audit + tenant isolation</span></div>
      </div>
      {notice ? <div className={`lifecycle-notice ${notice.kind}`}><CircleAlert size={15}/><span>{notice.message}</span></div> : null}
      <div className="lifecycle-command-grid">
        <form className="lifecycle-action-panel" onSubmit={submitPositionChange}>
          <div className="lifecycle-action-title"><ArrowRightLeft size={18}/><div><strong>Position change</strong><small>Transfer or promotion with vacancy and incumbent controls.</small></div></div>
          {!canMove ? <div className="lifecycle-restricted"><ShieldCheck size={16}/><span>This action requires people:write and positions:write.</span></div> : <>
            <label>Change type<select value={eventType} onChange={(event) => setEventType(event.target.value as "TRANSFERRED" | "PROMOTED")}><option value="TRANSFERRED">Transfer</option><option value="PROMOTED">Promotion</option></select></label>
            <label>Target position<select value={targetPositionId} onChange={(event) => setTargetPositionId(event.target.value)} disabled={loadingPositions || busy}><option value="">{loadingPositions ? "Loading open positions…" : "Select an open position"}</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.positionCode} · {position.title} · {position.orgUnit?.name ?? "Unassigned"}</option>)}</select></label>
            {selected ? <div className="lifecycle-target-preview"><BriefcaseBusiness size={16}/><div><strong>{selected.title}</strong><small>{selected.positionCode} · {selected.orgUnit?.name ?? "Unassigned"} · {selected.location ?? "Location not set"}</small></div></div> : null}
            <div className="lifecycle-form-row"><label>Effective date<input type="date" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required/></label><label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Business reason / approval reference"/></label></div>
            <button className="create-button" type="submit" disabled={busy || loadingPositions || !targetPositionId}>{eventType === "PROMOTED" ? <TrendingUp size={16}/> : <ArrowRightLeft size={16}/>} {busy ? "Applying…" : eventType === "PROMOTED" ? "Apply promotion" : "Apply transfer"}</button>
          </>}
        </form>

        <div className="lifecycle-action-panel">
          <div className="lifecycle-action-title"><BadgeCheck size={18}/><div><strong>Separation / offboarding</strong><small>Termination is orchestrated through the governed offboarding process, never as a direct record edit.</small></div></div>
          <div className="lifecycle-rule-list"><div><span>1</span><p>Create separation process and last working date</p></div><div><span>2</span><p>Complete HR, manager, IT, facilities and payroll controls</p></div><div><span>3</span><p>Revoke access, recover assets and close final settlement</p></div><div><span>4</span><p>Finalize employment and write termination lifecycle evidence</p></div></div>
          {canOffboard ? <a className="secondary-button lifecycle-offboard-link" href="/module/offboarding"><ExternalLink size={15}/> Open governed offboarding</a> : <div className="lifecycle-restricted"><ShieldCheck size={16}/><span>Your role does not include offboarding:write.</span></div>}
        </div>
      </div>
    </section>

    <section className="card lifecycle-control-note"><ShieldCheck size={18}/><div><strong>Control boundary</strong><p>Position changes require an open target position and reject duplicate incumbents. Every successful change updates the position register, employee lifecycle ledger and immutable audit evidence in one transaction.</p></div></section>
  </div>;
}
