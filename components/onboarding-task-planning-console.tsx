"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Plus, ShieldCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { OnboardingOperationsSnapshot } from "@/lib/onboarding-operations-data";
import styles from "./onboarding-task-planning.module.css";

const openStates = new Set(["NOT_STARTED", "IN_PROGRESS", "BLOCKED"]);
const teams = ["HR", "IT", "MANAGER", "SECURITY", "EMPLOYEE", "FACILITIES", "PAYROLL", "FINANCE", "LEGAL"];
const teamLabels: Record<string, string> = { HR: "İK", IT: "BT", MANAGER: "Yönetici", SECURITY: "Güvenlik", EMPLOYEE: "Çalışan", FACILITIES: "İdari işler", PAYROLL: "Bordro", FINANCE: "Finans", LEGAL: "Hukuk" };

export function OnboardingTaskPlanningConsole({ snapshot, onBusyChange, onSaved }: {
  snapshot: OnboardingOperationsSnapshot;
  onBusyChange: (busy: boolean) => void;
  onSaved: () => void;
}) {
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"create" | "deadline">("create");
  const [planId, setPlanId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [title, setTitle] = useState("");
  const [ownerType, setOwnerType] = useState("HR");
  const [sensitive, setSensitive] = useState(false);
  const [due, setDue] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("");
  const inFlight = useRef(false);
  const requestId = useRef<string | null>(null);
  const mounted = useRef(true);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => {
    mounted.current = true;
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    return () => { mounted.current = false; busyCallback.current(false); };
  }, []);

  const plans = snapshot.plans.filter((plan) => openStates.has(plan.planStatus) && plan.employmentStatus === "PREBOARDING");
  const plan = plans.find((item) => item.id === planId);
  const unscheduled = snapshot.tasks.filter((task) => task.planId === planId && openStates.has(task.status) && task.dueDate === null);
  const task = unscheduled.find((item) => item.id === taskId);
  const canSubmit = Boolean(plan && due && reason.trim().length >= 10 && (mode === "create" ? title.trim() : task));

  function errorMessage(code: string) {
    const messages: Record<string, string> = {
      CONFLICT: c("The record changed or this request was already used. Reload and check before another action.", "Kayıt değişti veya bu istek daha önce kullanıldı. Yenileyip sonucu kontrol edin."),
      DEADLINE_EXISTS: c("A deadline is already assigned. This form cannot replace or postpone it.", "Son tarih zaten atanmış. Bu form tarihi değiştiremez veya erteleyemez."),
      PLAN_LOCKED: c("Only open plans linked to preboarding employment can be planned.", "Yalnızca işe başlama öncesi istihdama bağlı açık planlar düzenlenebilir."),
      TASK_LOCKED: c("Completed or waived tasks cannot be scheduled.", "Tamamlanan veya muaf görevlerin tarihi düzenlenemez."),
      NOT_FOUND: c("This record is no longer available in your onboarding scope.", "Bu kayıt artık işe başlatma kapsamınızda kullanılamıyor."),
      FORBIDDEN: c("Your onboarding planning authority is unavailable.", "İşe başlatma planlama yetkiniz kullanılamıyor."),
      UNAUTHORIZED: c("Your session must be renewed.", "Oturumunuzu yenilemeniz gerekiyor.")
    };
    return messages[code] ?? c("The result could not be verified. Reload and check the record before retrying; the request will not be repeated automatically.", "Sonuç doğrulanamadı. Tekrar denemeden önce yenileyip kaydı kontrol edin; istek otomatik tekrarlanmayacak.");
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || pending || locked || !canSubmit || !plan) return;
    // The browser's explicit local time is converted to canonical UTC for the API.
    const dueDate = new Date(due);
    if (!Number.isFinite(dueDate.getTime())) { setNotice(c("Enter a valid deadline.", "Geçerli bir son tarih girin.")); return; }
    if (mode === "deadline" && !task) return;
    inFlight.current = true;
    setPending(true); onBusyChange(true); setNotice(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    try {
      requestId.current ??= window.crypto.randomUUID();
      const base = { dueDate: dueDate.toISOString(), reason: reason.trim(), expectedPlanStatus: plan.planStatus };
      const payload = mode === "create"
        ? { ...base, title: title.trim(), ownerType, sensitive, requestId: requestId.current }
        : { ...base, expectedTaskStatus: task!.status };
      const endpoint = mode === "create"
        ? `/api/onboarding/plans/${encodeURIComponent(plan.id)}/tasks`
        : `/api/onboarding/tasks/${encodeURIComponent(task!.id)}/deadline`;
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
        signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null) as { code?: string; data?: { id?: string; planId?: string; dueDate?: string } } | null;
      if (!mounted.current) return;
      if (!response.ok || !body?.data?.id || body.data.planId !== plan.id || body.data.dueDate !== dueDate.toISOString()) {
        setLocked(true); setNotice(errorMessage(body?.code ?? "FAILED")); return;
      }
      // Parent reloads the current authorized page/focus, not a cached optimistic task.
      onSaved();
    } catch {
      if (mounted.current) { setLocked(true); setNotice(errorMessage("FAILED")); }
    } finally {
      window.clearTimeout(timer); inFlight.current = false;
      if (mounted.current) { setPending(false); onBusyChange(false); }
    }
  }

  if (!plans.length) return null;
  return <section className={`card ${styles.console}`} aria-busy={pending}>
    <header><div><h3><CalendarPlus size={18}/>{c("Resolve planning gaps", "Planlama eksiklerini tamamla")}</h3><p>{c("Add an unstarted control or assign a missing deadline. Existing deadlines and completed controls remain protected.", "Başlamamış bir görev ekleyin veya eksik son tarihi atayın. Mevcut tarihler ve tamamlanmış görevler korunur.")}</p></div>
      <button type="button" className="secondary-button" disabled={pending || locked} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><Plus size={15}/>{expanded ? c("Close editor", "Düzenleyiciyi kapat") : c("Plan a task", "Görev planla")}</button></header>
    {notice ? <p role="alert" className="ats-notice error">{notice}</p> : null}
    {locked ? <button type="button" className="secondary-button" onClick={onSaved}>{c("Reload and verify outcome", "Yenile ve sonucu kontrol et")}</button> : null}
    {expanded ? <form onSubmit={(event) => void save(event)}>
      <fieldset disabled={pending || locked}><legend>{c("Audited task planning", "Denetim kayıtlı görev planlama")}</legend>
        <div className={styles.fields}>
          <label>{c("Plan on this page", "Bu sayfadaki plan")}<select required value={planId} onChange={(event) => { setPlanId(event.target.value); setTaskId(""); requestId.current = null; }}><option value="">{c("Choose a plan", "Plan seçin")}</option>{plans.map((item) => <option key={item.id} value={item.id}>{item.person} · {item.employeeNumber}</option>)}</select></label>
          <label>{c("Operation", "İşlem")}<select value={mode} onChange={(event) => { setMode(event.target.value as "create" | "deadline"); setTaskId(""); requestId.current = null; }}><option value="create">{c("Create a new task", "Yeni görev ekle")}</option><option value="deadline">{c("Assign a missing deadline", "Eksik son tarihi ata")}</option></select></label>
          {mode === "create" ? <>
            <label>{c("Task title", "Görev başlığı")}<input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)}/></label>
            <label>{c("Responsible team type (not a named assignee)", "Sorumlu ekip türü (kişi ataması değildir)")}<select value={ownerType} onChange={(event) => setOwnerType(event.target.value)}>{teams.map((team) => <option key={team} value={team}>{locale === "tr" ? teamLabels[team] : team}</option>)}</select></label>
            <label className={styles.checkbox}><input type="checkbox" checked={sensitive} onChange={(event) => setSensitive(event.target.checked)}/>{c("Sensitive control", "Hassas görev")}</label>
          </> : <label>{c("Open task without a deadline", "Son tarihi olmayan açık görev")}<select required value={taskId} onChange={(event) => setTaskId(event.target.value)}><option value="">{c("Choose a loaded task", "Yüklenen görevlerden seçin")}</option>{unscheduled.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
          <label>{c("Deadline", "Son tarih")}<input type="datetime-local" required value={due} onChange={(event) => setDue(event.target.value)}/><small>{c("Browser time zone", "Tarayıcı saat dilimi")}: {timezone || "…"}. {c("Saved as UTC.", "UTC olarak kaydedilir.")}</small></label>
          <label className={styles.reason}>{c("Reason (10–500 characters)", "Gerekçe (10–500 karakter)")}<textarea required minLength={10} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label>
        </div>
        <p className={styles.note}><ShieldCheck size={14}/>{c("Task and audit record are committed together. Do not put medical, payroll or identity details in titles or reasons. This action never activates an employee or clears a blocker. Past deadlines remain visible as overdue; they are not silently moved forward.", "Görev ve denetim kaydı birlikte kaydedilir. Başlık ve gerekçeye sağlık, ücret veya kimlik ayrıntıları yazmayın. Bu işlem çalışanı aktifleştirmez ve engeli kaldırmaz. Geçmiş tarihler gecikmiş görünür; sessizce ileri alınmaz.")}</p>
        {mode === "deadline" && plan && !unscheduled.length ? <p role="status">{c("No loaded open task is missing a deadline. Completed tasks and existing dates cannot be changed here.", "Yüklenen açık görevlerde eksik son tarih yok. Tamamlanan görevler ve atanmış tarihler buradan değiştirilemez.")}</p> : null}
        <button type="submit" className="primary-button" disabled={pending || locked || !canSubmit}>{pending ? c("Saving…", "Kaydediliyor…") : c("Save with audit record", "Denetim kaydıyla kaydet")}</button>
      </fieldset>
    </form> : null}
  </section>;
}
