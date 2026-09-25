"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, ClipboardCheck, Clock3, LockKeyhole, UserCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";

type Task = {
  id: string;
  planId: string;
  person: string;
  employeeNumber: string;
  planStatus: string;
  employmentStatus: string | null;
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
const START_RISK_WINDOW_MS = 72 * 60 * 60 * 1000;

function label(value: string, locale: "en" | "tr") {
  if (locale === "tr") {
    const labels: Record<string,string> = {
      NOT_STARTED:"Başlamadı", IN_PROGRESS:"Devam Ediyor", BLOCKED:"Engelli", COMPLETED:"Tamamlandı", WAIVED:"Muaf",
      PREBOARDING:"İşe Başlama Öncesi", ACTIVE:"Aktif", HR:"İK", MANAGER:"Yönetici", IT:"IT", SECURITY:"Güvenlik", EMPLOYEE:"Çalışan"
    };
    if (labels[value]) return labels[value];
  }
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function RiskMetric({ labelText, value, note, icon: Icon, risk = false }: { labelText: string; value: number; note: string; icon: React.ComponentType<{size?:number}>; risk?: boolean }) {
  return <div className="recruit-metric" data-risk={risk ? "true" : "false"}><span><Icon size={16}/></span><div><small>{labelText}</small><strong style={risk && value > 0 ? { color: "var(--red)" } : undefined}>{value}</strong><em>{note}</em></div></div>;
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

  async function activateEmployment(planId: string, person: string) {
    const key = `activate-${planId}`;
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(`/api/onboarding/plans/${planId}/activate`, {
        method: "POST",
        credentials: "same-origin"
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`,`İstek başarısız (${response.status})`));
      setNotice({ tone: "ok", text: c(`${person} is now an active employee.`,`${person} artık aktif çalışan durumunda.`) });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Employment activation failed.","İstihdam aktifleştirilemedi.") });
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
    const key = `${task.planId}|${task.person}|${task.employeeNumber}|${task.planStatus}|${task.employmentStatus ?? ""}|${task.targetStartDate}`;
    grouped.set(key, [...(grouped.get(key) ?? []), task]);
  }
  const now = Date.now();
  const blockedTaskCount = tasks.filter((task) => task.status === "BLOCKED").length;
  const overdueTaskCount = tasks.filter((task) => !terminalTaskStatuses.has(task.status) && task.dueDate && new Date(task.dueDate).getTime() < now).length;
  const startRiskPlanIds = new Set(tasks.filter((task) => task.planStatus !== "COMPLETED" && new Date(task.targetStartDate).getTime() <= now + START_RISK_WINDOW_MS).map((task) => task.planId));
  const activationReadyPlanIds = new Set(tasks.filter((task) => task.planStatus === "COMPLETED" && task.employmentStatus === "PREBOARDING").map((task) => task.planId));
  const hasNotificationContext = Boolean(focusedTaskId || focusedPlanId);
  const notificationContextResolved = focusedTaskId
    ? tasks.some((task) => task.id === focusedTaskId)
    : focusedPlanId
      ? tasks.some((task) => task.planId === focusedPlanId)
      : false;

  return <section className="onb-console card">
    <div className="onb-console-head"><div><span className="section-kicker">{c("Controlled onboarding execution","Kontrollü işe başlatma yürütümü")}</span><h3>{c("Day-one readiness console","İlk gün hazırlık konsolu")}</h3><p>{c("HR, IT and manager tasks are state-controlled. Blockers and waivers require an auditable reason. Completed onboarding remains visible until HR performs the governed handoff from preboarding to active employment on or after the start date.","İK, IT ve yönetici görevleri durum kontrollüdür. Engel ve muafiyetler denetlenebilir gerekçe ister. Tamamlanan onboarding, İK başlangıç tarihinde veya sonrasında işe başlama öncesi durumdan aktif istihdama kontrollü devri yapana kadar görünür kalır.")}</p></div><span><ClipboardCheck size={16}/> {tasks.length} {c("tracked tasks","izlenen görev")}</span></div>
    <div className="recruit-metrics" style={{ marginBottom: 12 }}>
      <RiskMetric labelText={c("Plans in queue","Kuyruktaki planlar")} value={grouped.size} note={c("Readiness + activation handoff","Hazırlık + aktivasyon devri")} icon={ClipboardCheck}/>
      <RiskMetric labelText={c("Blocked tasks","Engelli görevler")} value={blockedTaskCount} note={c("Explicit blocker state","Açık engel durumu")} icon={CircleAlert} risk/>
      <RiskMetric labelText={c("Overdue tasks","Gecikmiş görevler")} value={overdueTaskCount} note={c("Open task past due date","Son tarihi geçmiş açık görev")} icon={Clock3} risk/>
      <RiskMetric labelText={c("Start-date risk","Başlangıç tarihi riski")} value={startRiskPlanIds.size} note={c("Open plan within 72 hours","72 saat içinde açık plan")} icon={Clock3} risk/>
      <RiskMetric labelText={c("Ready to activate","Aktivasyona hazır")} value={activationReadyPlanIds.size} note={c("Completed plan + preboarding","Tamamlanan plan + preboarding")} icon={UserCheck}/>
    </div>
    {notice ? <div className={`ats-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}
    {hasNotificationContext ? <div className={`ats-notice ${notificationContextResolved ? "ok" : "error"}`}><span>{notificationContextResolved ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notificationContextResolved ? c("Notification context resolved. The relevant onboarding record is highlighted below.","Bildirim bağlamı çözüldü. İlgili işe başlatma kaydı aşağıda vurgulandı.") : c("This notification points to an onboarding record that is no longer in the active readiness or activation queue.","Bu bildirim artık aktif hazırlık veya aktivasyon kuyruğunda olmayan bir işe başlatma kaydına işaret ediyor.")}</div> : null}
    <div className="onb-plan-list">{[...grouped.entries()].map(([key, planTasks]) => {
      const [planId, person, employeeNumber, planStatus, employmentStatus, targetStartDate] = key.split("|");
      const completed = planTasks.filter((task) => terminalTaskStatuses.has(task.status)).length;
      const blocked = planTasks.filter((task) => task.status === "BLOCKED").length;
      const overdue = planTasks.filter((task) => !terminalTaskStatuses.has(task.status) && task.dueDate && new Date(task.dueDate).getTime() < now).length;
      const startAt = new Date(targetStartDate).getTime();
      const startDateReached = Number.isFinite(startAt) && startAt <= now;
      const startRisk = planStatus !== "COMPLETED" && Number.isFinite(startAt) && startAt <= now + START_RISK_WINDOW_MS;
      const readinessRisk = blocked > 0 || overdue > 0 || startRisk;
      const readyForActivation = planStatus === "COMPLETED" && employmentStatus === "PREBOARDING";
      const planFocused = focusedPlanId === planId;
      return <article id={`onboarding-plan-${planId}`} className={`onb-plan${planFocused ? " onb-focused" : ""}${readinessRisk ? " onb-plan-risk" : ""}`} style={planFocused ? { outline: "2px solid var(--accent)", outlineOffset: 2 } : undefined} key={planId}><header><div><strong>{person}</strong><small>{employeeNumber} · {c("Plan","Plan")} {label(planStatus,locale)} · {employmentStatus ? label(employmentStatus,locale) : c("Employment not linked","İstihdam bağlı değil")} · {c("Starts","Başlangıç")} {new Date(targetStartDate).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB")}</small></div><div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}><span style={readinessRisk ? { color: "var(--red)" } : undefined}>{completed}/{planTasks.length} {c("clear","tamam")}{blocked ? ` · ${blocked} ${c("blocked","engelli")}` : ""}{overdue ? ` · ${overdue} ${c("overdue","gecikmiş")}` : ""}{startRisk ? ` · ${c("start risk <72h","başlangıç riski <72s")}` : ""}</span>{readyForActivation ? <button type="button" className="secondary-button" style={{ minHeight: 28, padding: "5px 8px", fontSize: 8 }} disabled={pending !== null || !startDateReached} onClick={() => void activateEmployment(planId, person)} title={!startDateReached ? c("Activation is available on or after the governed start date.","Aktivasyon kontrollü başlangıç tarihinde veya sonrasında kullanılabilir.") : undefined}><UserCheck size={13}/>{pending === `activate-${planId}` ? "…" : startDateReached ? c("Activate employee","Çalışanı aktifleştir") : c("Ready for start date","Başlangıç tarihini bekliyor")}</button> : null}</div></header><div className="onb-task-list">{planTasks.map((task) => {
        const taskFocused = focusedTaskId === task.id;
        const taskOverdue = !terminalTaskStatuses.has(task.status) && Boolean(task.dueDate) && new Date(task.dueDate as string).getTime() < now;
        return <div id={`onboarding-task-${task.id}`} className={`onb-task${taskFocused ? " onb-focused" : ""}`} style={taskFocused ? { outline: "2px solid var(--accent)", outlineOffset: -2 } : undefined} key={task.id}><div className="onb-task-copy">{task.sensitive ? <LockKeyhole size={13}/> : <CheckCircle2 size={13}/>}<span><strong>{task.title}</strong><small style={taskOverdue ? { color: "var(--red)" } : undefined}>{label(task.ownerType,locale)} · {task.dueDate ? `${c("Due","Son tarih")} ${new Date(task.dueDate).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB")}${taskOverdue ? ` · ${c("OVERDUE","GECİKMİŞ")}` : ""}` : c("Policy-driven due date","Politika temelli son tarih")}</small></span></div><em className={`pill ${task.status.toLowerCase().replaceAll("_", "-")}`}>{label(task.status,locale)}</em><div className="ats-actions">{(transitions[task.status] ?? []).map((next) => <button type="button" key={next} disabled={pending !== null} onClick={() => requestTransition(task, next)}>{pending === `${task.id}-${next}` ? "…" : label(next,locale)}</button>)}</div>{reasonEditor?.taskId === task.id ? <div className="onb-reason-editor" style={{ gridColumn: "1 / -1", display: "grid", gap: 8, padding: "9px 0 2px", borderTop: "1px dashed var(--line-strong)" }}><label style={{ display: "grid", gap: 5, color: "var(--muted)", fontSize: 8, fontWeight: 750 }}><span>{reasonEditor.status === "WAIVED" ? c("Waiver reason","Muafiyet gerekçesi") : c("Blocker reason","Engel gerekçesi")}</span><textarea maxLength={500} autoFocus value={reasonEditor.text} onChange={(event) => setReasonEditor({ ...reasonEditor, text: event.target.value })} placeholder={reasonEditor.status === "WAIVED" ? c("Explain why this control can be waived.","Bu kontrolün neden muaf tutulabileceğini açıklayın.") : c("Describe the blocker and the operational impact.","Engeli ve operasyonel etkisini açıklayın.")} style={{ minHeight: 70, resize: "vertical", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--surface)", color: "var(--text)", padding: 9, font: "inherit" }}/></label><div className="ats-actions"><button type="button" disabled={pending !== null || !reasonEditor.text.trim()} onClick={() => void changeStatus(task, reasonEditor.status, reasonEditor.text.trim())}>{c("Confirm","Onayla")}</button><button type="button" disabled={pending !== null} onClick={() => setReasonEditor(null)}>{c("Cancel","Vazgeç")}</button></div></div> : null}</div>;
      })}</div></article>;
    })}</div>
  </section>;
}
