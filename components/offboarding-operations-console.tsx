"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, CircleAlert, ClipboardCheck, LockKeyhole, ShieldCheck, UserMinus } from "lucide-react";
import type { OffboardingEligibleEmployment, OffboardingProcessRow } from "@/lib/offboarding-live-data";

type Notice = { kind: "ok" | "error"; message: string } | null;

const separationTypes = [
  ["RESIGNATION", "Resignation"],
  ["TERMINATION", "Termination"],
  ["REDUNDANCY", "Redundancy"],
  ["RETIREMENT", "Retirement"],
  ["END_OF_CONTRACT", "End of contract"],
  ["OTHER", "Other"]
] as const;

export function OffboardingOperationsConsole({
  processes,
  employments
}: {
  processes: OffboardingProcessRow[];
  employments: OffboardingEligibleEmployment[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [employmentId, setEmploymentId] = useState("");
  const [type, setType] = useState("RESIGNATION");
  const [noticeDate, setNoticeDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lastWorkingDate, setLastWorkingDate] = useState("");
  const [reasonCode, setReasonCode] = useState("");

  async function call(url: string, init: RequestInit, success: string) {
    setBusy(url);
    setNotice(null);
    try {
      const response = await fetch(url, init);
      const payload = await response.json() as { error?: string; open?: { tasks?: number; assets?: number; access?: number } };
      if (!response.ok) {
        const open = payload.open ? ` Open controls: tasks ${payload.open.tasks ?? 0}, assets ${payload.open.assets ?? 0}, access ${payload.open.access ?? 0}.` : "";
        throw new Error(`${payload.error || "Operation failed."}${open}`);
      }
      setNotice({ kind: "ok", message: success });
      router.refresh();
      return true;
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Operation failed." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createProcess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employmentId || !lastWorkingDate) {
      setNotice({ kind: "error", message: "Select an employee and last working date." });
      return;
    }
    const ok = await call("/api/offboarding/processes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ employmentId, type, noticeDate, lastWorkingDate, reasonCode: reasonCode || undefined })
    }, "Separation process created with cross-functional clearance tasks.");
    if (ok) {
      setEmploymentId("");
      setLastWorkingDate("");
      setReasonCode("");
    }
  }

  async function completeTask(processId: string, taskId: string, waive = false) {
    await call(`/api/offboarding/processes/${encodeURIComponent(processId)}/tasks/${encodeURIComponent(taskId)}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ waive })
    }, waive ? "Task waived with audit evidence." : "Task completed and recorded in the exit evidence trail.");
  }

  async function closeProcess(processId: string) {
    await call(`/api/offboarding/processes/${encodeURIComponent(processId)}/close`, { method: "POST" }, "Separation closed. Employment was terminated and the lifecycle event was written.");
  }

  return <section className="card off-ops-console">
    <div className="off-ops-head"><div><span className="section-kicker">Controlled transaction layer</span><h3>Offboarding operations</h3><p>Start separations, clear blocking tasks and close employment only after the exit gate is satisfied.</p></div><span><ShieldCheck size={15}/> Restricted workflow</span></div>
    {notice ? <div className={`off-ops-notice ${notice.kind}`}><CircleAlert size={15}/>{notice.message}</div> : null}
    <div className="off-ops-grid">
      <form className="off-create-form" onSubmit={createProcess}>
        <div className="off-form-title"><UserMinus size={18}/><div><strong>New separation</strong><small>Creates HR, Manager, IT, Facilities and Payroll clearance controls.</small></div></div>
        <label>Employee<select value={employmentId} onChange={(event) => setEmploymentId(event.target.value)}><option value="">Select active employment</option>{employments.map((employment) => <option value={employment.id} key={employment.id}>{employment.employeeNumber} · {employment.employee} · {employment.position}</option>)}</select></label>
        <div className="off-form-row"><label>Type<select value={type} onChange={(event) => setType(event.target.value)}>{separationTypes.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select></label><label>Reason code<input value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} placeholder="e.g. voluntary-resignation"/></label></div>
        <div className="off-form-row"><label>Notice date<input type="date" value={noticeDate} onChange={(event) => setNoticeDate(event.target.value)}/></label><label>Last working date<input type="date" value={lastWorkingDate} onChange={(event) => setLastWorkingDate(event.target.value)} required/></label></div>
        <button className="create-button" type="submit" disabled={Boolean(busy) || !employmentId || !lastWorkingDate}><UserMinus size={16}/> {busy === "/api/offboarding/processes" ? "Creating…" : "Start separation"}</button>
      </form>

      <div className="off-process-stack">
        <div className="off-form-title"><ClipboardCheck size={18}/><div><strong>Active clearance processes</strong><small>Blocking controls must be completed or explicitly waived before closure.</small></div></div>
        {processes.length ? processes.map((process) => <article className="off-process-card" key={process.id}>
          <header><div><strong>{process.employee}</strong><small>{process.employeeNumber} · {process.position} · {process.type}</small></div><em className={`off-pill ${process.status.toLowerCase().replaceAll(" ", "-")}`}>{process.status}</em></header>
          <div className="off-process-meta"><span>Last day <b>{process.lastWorkingDate}</b></span><span>Tasks <b>{process.completedTasks}/{process.taskCount}</b></span><span>Blocking <b>{process.openBlockingTasks}</b></span><span>Assets <b>{process.assetsOpen}</b></span><span>Access <b>{process.accessOpen}</b></span></div>
          <div className="off-task-list">{process.tasks.map((task) => <div key={task.id}><span className={task.rawStatus === "COMPLETED" || task.rawStatus === "WAIVED" ? "done" : task.rawStatus === "BLOCKED" ? "blocked" : "pending"}/><div><strong>{task.title}</strong><small>{task.domain} · {task.dueAt} · {task.status}{task.blocking ? " · Blocking" : ""}</small></div>{task.rawStatus === "COMPLETED" || task.rawStatus === "WAIVED" ? <BadgeCheck size={16}/> : <div className="off-task-actions"><button disabled={Boolean(busy)} onClick={() => completeTask(process.id, task.id)}>Complete</button><button disabled={Boolean(busy)} onClick={() => completeTask(process.id, task.id, true)}>Waive</button></div>}</div>)}</div>
          <footer><div className={process.readyToClose ? "off-ready" : "off-not-ready"}>{process.readyToClose ? <BadgeCheck size={14}/> : <LockKeyhole size={14}/>} {process.readyToClose ? "Closure gate clear" : "Open blocking controls remain"}</div><button className="secondary-button" onClick={() => closeProcess(process.id)} disabled={Boolean(busy) || !process.readyToClose}>Close separation</button></footer>
        </article>) : <div className="off-empty">No active separation process. Start one when an employee exit is approved.</div>}
      </div>
    </div>
  </section>;
}
