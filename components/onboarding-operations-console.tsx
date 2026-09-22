"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, ClipboardCheck, LockKeyhole } from "lucide-react";
import { useLocale } from "@/components/locale-provider";

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
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`,`İstek başarısız (${response.status})`));
      setNotice({ tone: "ok", text: c(`${task.title} moved to ${label(status,locale)}.`,`${task.title} → ${label(status,locale)} durumuna alındı.`) });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Task update failed.","Görev güncellenemedi.") });
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
    <div className="onb-console-head"><div><span className="section-kicker">{c("Controlled onboarding execution","Kontrollü işe başlatma yürütümü")}</span><h3>{c("Day-one readiness console","İlk gün hazırlık konsolu")}</h3><p>{c("HR, IT and manager tasks are state-controlled. Plan status is recalculated after every task transition and sensitive tasks carry a Restricted audit classification.","İK, IT ve yönetici görevleri durum kontrollüdür. Her görev geçişinden sonra plan durumu yeniden hesaplanır ve hassas görevler Kısıtlı denetim sınıflandırması taşır.")}</p></div><span><ClipboardCheck size={16}/> {tasks.length} {c("active tasks","aktif görev")}</span></div>
    {notice ? <div className={`ats-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}
    <div className="onb-plan-list">{[...grouped.entries()].map(([key, planTasks]) => {
      const [planId, person, employeeNumber, planStatus] = key.split("|");
      const completed = planTasks.filter((task) => task.status === "COMPLETED" || task.status === "WAIVED").length;
      return <article className="onb-plan" key={planId}><header><div><strong>{person}</strong><small>{employeeNumber} · {c("Plan","Plan")} {label(planStatus,locale)}</small></div><span>{completed}/{planTasks.length} {c("clear","tamam")}</span></header><div className="onb-task-list">{planTasks.map((task) => <div className="onb-task" key={task.id}><div className="onb-task-copy">{task.sensitive ? <LockKeyhole size={13}/> : <CheckCircle2 size={13}/>}<span><strong>{task.title}</strong><small>{label(task.ownerType,locale)} · {task.dueDate ? `${c("Due","Son tarih")} ${new Date(task.dueDate).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB")}` : c("Policy-driven due date","Politika temelli son tarih")}</small></span></div><em className={`pill ${task.status.toLowerCase().replaceAll("_", "-")}`}>{label(task.status,locale)}</em><div className="ats-actions">{(transitions[task.status] ?? []).map((next) => <button type="button" key={next} disabled={pending !== null} onClick={() => void changeStatus(task, next)}>{pending === `${task.id}-${next}` ? "…" : label(next,locale)}</button>)}</div></div>)}</div></article>;
    })}</div>
  </section>;
}
