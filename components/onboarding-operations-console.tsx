"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, ClipboardCheck, LockKeyhole } from "lucide-react";
import { useLocale } from "@/components/locale-provider";

type Task = {
  id: string;
  planId: string;
  person: string;
  employeeNumber: string;
  planStatus: string;
  targetStartDate: string;
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

const terminalTaskStatuses = new Set(["COMPLETED", "WAIVED"]);

function label(value: string, locale: "en" | "tr") {
  if (locale === "tr") {
    const labels: Record<string,string> = {
      NOT_STARTED:"Başlamadı", IN_PROGRESS:"Devam Ediyor", BLOCKED:"Engelli", COMPLETED:"Tamamlandı", WAIVED:"Muaf",
      HR:"İK", MANAGER:"Yönetici", IT:"IT", SECURITY:"Güvenlik", EMPLOYEE:"Çalışan"
    };
    if (labels[value]) return labels[value];
  }
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export function OnboardingOperationsConsole({ tasks }: { tasks: Task[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en:string,tr:string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [reasonEditor, setReasonEditor] = useState<{ taskId: string; status: string; text: string } | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [focusedPlanId, setFocusedPlanId] = useState<string | null>(null);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const taskId = search.get("task");
    const planId = search.get("plan");
    setFocusedTaskId(taskId);
    setFocusedPlanId(planId);
    const targetId = taskId ? `onboarding-task-${taskId}` : planId ? `onboarding-plan-${planId}` : null;
    if (!targetId) return;
    const timer = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, []);

  async function changeStatus(task: Task, status: string, note?: string) {
    const key = `${task.id}-${status}`;
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(`/api/onboarding/tasks/${task.id}/status`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, ...(note ? { note } : {}) })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`,`İstek başarısız (${response.status})`));
      setNotice({ tone: "ok", text: c(`${task.title} moved to ${label(status,locale)}.`,`${task.title} → ${label(status,locale)} durumuna alındı.`) });
      setReasonEditor(null);
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Task update failed.","Görev güncellenemedi.") });
    } finally {
      setPending(null);
    }
  }

  function requestTransition(task: Task, status: string) {
    if (status === "BLOCKED" || status === "WAIVED") {
      setReasonEditor({ taskId: task.id, status, text: "" });
      return;
    }
    void changeStatus(task, status);
  }

  const grouped = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = `${task.planId}|${task.person}|${task.employeeNumber}|${task.planStatus}|${task.targetStartDate}`;
    grouped.set(key, [...(grouped.get(key) ?? []), task]);
  }
  const now = Date.now();
  const hasNotificationContext = Boolean(focusedTaskId || focusedPlanId);
  const notificationContextResolved = focusedTaskId
    ? tasks.some((task) => task.id === focusedTaskId)
    : focusedPlanId
      ? tasks.some((task) => task.planId === focusedPlanId)
      : false;

  return <section className="onb-console card">
    <div className="onb-console-head"><div><span className="section-kicker">{c("Controlled onboarding execution","Kontrollü işe başlatma yürütümü")}</span><h3>{c("Day-one readiness console","İlk gün hazırlık konsolu")}</h3><p>{c("HR, IT and manager tasks are state-controlled. Blockers and waivers require an auditable reason, plan completion is gated on every task, and scheduled maintenance escalates due-date and start-date readiness risk.","İK, IT ve yönetici görevleri durum kontrollüdür. Engel ve muafiyetler denetlenebilir gerekçe ister, plan kapanışı tüm görevlere bağlıdır ve zamanlanmış bakım son tarih ile başlangıç hazırlığı risklerini eskale eder.")}</p></div><span><ClipboardCheck size={16}/> {tasks.length} {c("active tasks","aktif görev")}</span></div>
    {notice ? <div className={`ats-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}
    {hasNotificationContext ? <div className={`ats-notice ${notificationContextResolved ? "ok" : "error"}`}><span>{notificationContextResolved ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notificationContextResolved ? c("Notification context resolved. The relevant onboarding record is highlighted below.","Bildirim bağlamı çözüldü. İlgili işe başlatma kaydı aşağıda vurgulandı.") : c("This notification points to an onboarding record that is no longer in the active readiness queue.","Bu bildirim artık aktif hazırlık kuyruğunda olmayan bir işe başlatma kaydına işaret ediyor.")}</div> : null}
    <div className="onb-plan-list">{[...grouped.entries()].map(([key, planTasks]) => {
      const [planId, person, employeeNumber, planStatus, targetStartDate] = key.split("|");
      const completed = planTasks.filter((task) => terminalTaskStatuses.has(task.status)).length;
      const blocked = planTasks.filter((task) => task.status === "BLOCKED").length;
      const overdue = planTasks.filter((task) => !terminalTaskStatuses.has(task.status) && task.dueDate && new Date(task.dueDate).getTime() < now).length;
      const startAt = new Date(targetStartDate).getTime();
      const startRisk = Number.isFinite(startAt) && startAt <= now + 72 * 60 * 60 * 1000;
      const readinessRisk = blocked > 0 || overdue > 0 || startRisk;
      const planFocused = focusedPlanId === planId;
      return <article id={`onboarding-plan-${planId}`} className={`onb-plan${planFocused ? " onb-focused" : ""}${readinessRisk ? " onb-plan-risk" : ""}`} style={planFocused ? { outline: "2px solid var(--accent)", outlineOffset: 2 } : undefined} key={planId}><header><div><strong>{person}</strong><small>{employeeNumber} · {c("Plan","Plan")} {label(planStatus,locale)} · {c("Starts","Başlangıç")} {new Date(targetStartDate).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB")}</small></div><span style={readinessRisk ? { color: "var(--red)" } : undefined}>{completed}/{planTasks.length} {c("clear","tamam")}{blocked ? ` · ${blocked} ${c("blocked","engelli")}` : ""}{overdue ? ` · ${overdue} ${c("overdue","gecikmiş")}` : ""}</span></header><div className="onb-task-list">{planTasks.map((task) => {
        const taskFocused = focusedTaskId === task.id;
        return <div id={`onboarding-task-${task.id}`} className={`onb-task${taskFocused ? " onb-focused" : ""}`} style={taskFocused ? { outline: "2px solid var(--accent)", outlineOffset: -2 } : undefined} key={task.id}><div className="onb-task-copy">{task.sensitive ? <LockKeyhole size={13}/> : <CheckCircle2 size={13}/>}<span><strong>{task.title}</strong><small>{label(task.ownerType,locale)} · {task.dueDate ? `${c("Due","Son tarih")} ${new Date(task.dueDate).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB")}` : c("Policy-driven due date","Politika temelli son tarih")}</small></span></div><em className={`pill ${task.status.toLowerCase().replaceAll("_", "-")}`}>{label(task.status,locale)}</em><div className="ats-actions">{(transitions[task.status] ?? []).map((next) => <button type="button" key={next} disabled={pending !== null} onClick={() => requestTransition(task, next)}>{pending === `${task.id}-${next}` ? "…" : label(next,locale)}</button>)}</div>{reasonEditor?.taskId === task.id ? <div className="onb-reason-editor" style={{ gridColumn: "1 / -1", display: "grid", gap: 8, padding: "9px 0 2px", borderTop: "1px dashed var(--line-strong)" }}><label style={{ display: "grid", gap: 5, color: "var(--muted)", fontSize: 8, fontWeight: 750 }}><span>{reasonEditor.status === "WAIVED" ? c("Waiver reason","Muafiyet gerekçesi") : c("Blocker reason","Engel gerekçesi")}</span><textarea maxLength={500} autoFocus value={reasonEditor.text} onChange={(event) => setReasonEditor({ ...reasonEditor, text: event.target.value })} placeholder={reasonEditor.status === "WAIVED" ? c("Explain why this control can be waived.","Bu kontrolün neden muaf tutulabileceğini açıklayın.") : c("Describe the blocker and the operational impact.","Engeli ve operasyonel etkisini açıklayın.")} style={{ minHeight: 70, resize: "vertical", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--surface)", color: "var(--text)", padding: 9, font: "inherit" }}/></label><div className="ats-actions"><button type="button" disabled={pending !== null || !reasonEditor.text.trim()} onClick={() => void changeStatus(task, reasonEditor.status, reasonEditor.text.trim())}>{c("Confirm","Onayla")}</button><button type="button" disabled={pending !== null} onClick={() => setReasonEditor(null)}>{c("Cancel","Vazgeç")}</button></div></div> : null}</div>;
      })}</div></article>;
    })}</div>
  </section>;
}
