"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, ClipboardCheck, LockKeyhole } from "lucide-react";

type Task = {
  id: string;
  planId: string;
  person: string;
  employeeNumber: string;
  planStatus: string;
  title: string;
  ownerType: string;
  status: string;
  dueDate: string | null;
  sensitive: boolean;
};

const transitions: Record<string, string[]> = {
  NOT_STARTED: ["IN_PROGRESS", "BLOCKED", "COMPLETED", "WAIVED"],
  IN_PROGRESS: ["BLOCKED", "COMPLETED", "WAIVED"],
  BLOCKED: ["IN_PROGRESS", "WAIVED"]
};

function label(value: string) {
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export function OnboardingOperationsConsole({ tasks }: { tasks: Task[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function changeStatus(task: Task, status: string) {
    const key = `${task.id}-${status}`;
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(`/api/onboarding/tasks/${task.id}/status`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
      setNotice({ tone: "ok", text: `${task.title} moved to ${label(status)}.` });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Task update failed." });
    } finally {
      setPending(null);
    }
  }

  const grouped = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = `${task.planId}|${task.person}|${task.employeeNumber}|${task.planStatus}`;
    grouped.set(key, [...(grouped.get(key) ?? []), task]);
  }

  return <section className="onb-console card">
    <div className="onb-console-head"><div><span className="section-kicker">Controlled onboarding execution</span><h3>Day-one readiness console</h3><p>HR, IT and manager tasks are state-controlled. Plan status is recalculated after every task transition and sensitive tasks carry a Restricted audit classification.</p></div><span><ClipboardCheck size={16}/> {tasks.length} active tasks</span></div>
    {notice ? <div className={`ats-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}
    <div className="onb-plan-list">{[...grouped.entries()].map(([key, planTasks]) => {
      const [planId, person, employeeNumber, planStatus] = key.split("|");
      const completed = planTasks.filter((task) => task.status === "COMPLETED" || task.status === "WAIVED").length;
      return <article className="onb-plan" key={planId}><header><div><strong>{person}</strong><small>{employeeNumber} · Plan {label(planStatus)}</small></div><span>{completed}/{planTasks.length} clear</span></header><div className="onb-task-list">{planTasks.map((task) => <div className="onb-task" key={task.id}><div className="onb-task-copy">{task.sensitive ? <LockKeyhole size={13}/> : <CheckCircle2 size={13}/>}<span><strong>{task.title}</strong><small>{task.ownerType} · {task.dueDate ? `Due ${new Date(task.dueDate).toLocaleDateString()}` : "Policy-driven due date"}</small></span></div><em className={`pill ${task.status.toLowerCase().replaceAll("_", "-")}`}>{label(task.status)}</em><div className="ats-actions">{(transitions[task.status] ?? []).map((next) => <button type="button" key={next} disabled={pending !== null} onClick={() => void changeStatus(task, next)}>{pending === `${task.id}-${next}` ? "…" : label(next)}</button>)}</div></div>)}</div></article>;
    })}</div>
  </section>;
}
