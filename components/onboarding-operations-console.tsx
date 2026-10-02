"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, ClipboardCheck, Clock3, LockKeyhole, RefreshCw, UserCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { buildOnboardingReadiness, filterOnboardingReadiness, type ReadinessFilter, type ReadinessIssue, type ReadinessTask } from "@/lib/onboarding-readiness-view.mjs";
import type { OnboardingOperationsSnapshot } from "@/lib/onboarding-operations-data";
import styles from "./onboarding-readiness.module.css";

const transitions: Record<string, string[]> = {
  NOT_STARTED: ["IN_PROGRESS", "BLOCKED", "COMPLETED", "WAIVED"],
  IN_PROGRESS: ["BLOCKED", "COMPLETED", "WAIVED"],
  BLOCKED: ["IN_PROGRESS", "WAIVED"]
};
const terminalTaskStatuses = new Set(["COMPLETED", "WAIVED"]);
function label(value: string, locale: "en" | "tr") {
  const labels: Record<string, string> = {
    NOT_STARTED: "Başlamadı", IN_PROGRESS: "Devam ediyor", BLOCKED: "Engelli", COMPLETED: "Tamamlandı", WAIVED: "Muaf",
    PREBOARDING: "İşe başlama öncesi", ACTIVE: "Aktif", HR: "İK", MANAGER: "Yönetici", IT: "BT", SECURITY: "Güvenlik", EMPLOYEE: "Çalışan"
  };
  if (locale === "tr" && labels[value]) return labels[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}
function RiskMetric({ labelText, value, note, icon: Icon, risk = false }: { labelText: string; value: number; note: string; icon: React.ComponentType<{ size?: number }>; risk?: boolean }) {
  return <div className="recruit-metric" data-risk={risk ? "true" : "false"}><span><Icon size={16}/></span><div><small>{labelText}</small><strong className={risk && value > 0 ? styles.risk : undefined}>{value}</strong><em>{note}</em></div></div>;
}

// Retain the existing caller's `tasks` prop while accepting a plan-aware snapshot.
export function OnboardingOperationsConsole({ tasks: snapshot }: { tasks: OnboardingOperationsSnapshot }) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [reasonEditor, setReasonEditor] = useState<{ taskId: string; status: string; text: string } | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [focusedPlanId, setFocusedPlanId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReadinessFilter>("all");
  const [owner, setOwner] = useState("");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(20);
  const [clock, setClock] = useState(() => Date.parse(snapshot.generatedAt));
  const busy = pending !== null || refreshing;

  useEffect(() => {
    // Use the server snapshot clock on hydration, then monotonic elapsed time.
    const baseline = Date.parse(snapshot.generatedAt);
    const mountedAt = performance.now();
    setClock(baseline);
    const timer = window.setInterval(() => setClock(baseline + performance.now() - mountedAt), 30_000);
    return () => window.clearInterval(timer);
  }, [snapshot.generatedAt]);
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const bounded = (value: string | null) => value && value.length <= 160 ? value : null;
    setFocusedTaskId(bounded(search.get("task")));
    setFocusedPlanId(bounded(search.get("plan")));
  }, []);

  const now = Math.max(clock, Date.parse(snapshot.generatedAt));
  const view = useMemo(() => buildOnboardingReadiness(snapshot, now), [snapshot, now]);
  const focused = view.plans.find((plan) => focusedTaskId ? plan.tasks.some((task) => task.id === focusedTaskId) : plan.id === focusedPlanId);
  const filtered = filterOnboardingReadiness(view.plans, { filter, owner, query, locale });
  const ordered = focused && filtered.includes(focused) ? [focused, ...filtered.filter((plan) => plan.id !== focused.id)] : filtered;
  const visible = ordered.slice(0, visibleCount);
  const hasNotificationContext = Boolean(focusedTaskId || focusedPlanId);
  const notificationContextResolved = Boolean(focused);
  const focusVisible = Boolean(focused && visible.includes(focused));
  const owners = [...new Set(snapshot.tasks.map((task) => task.ownerType.trim().toUpperCase()).filter(Boolean))].sort();

  useEffect(() => {
    if (!focusVisible) return;
    const targetId = focusedTaskId ? `onboarding-task-${focusedTaskId}` : focusedPlanId ? `onboarding-plan-${focusedPlanId}` : null;
    if (!targetId) return;
    const timer = window.setTimeout(() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    return () => window.clearTimeout(timer);
  }, [focusedTaskId, focusedPlanId, focusVisible]);

  function refresh() { startRefresh(() => router.refresh()); }
  function clearFilters() { setFilter("all"); setOwner(""); setQuery(""); setVisibleCount(20); }
  async function changeStatus(task: ReadinessTask, status: string, note?: string) {
    if (inFlight.current || busy) return;
    if ((status === "BLOCKED" || status === "WAIVED") && !note?.trim()) return;
    inFlight.current = true;
    setPending(`${task.id}-${status}`);
    setNotice(null);
    try {
      const response = await fetch(`/api/onboarding/tasks/${encodeURIComponent(task.id)}/status`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, ...(note ? { note } : {}) })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`, `İstek başarısız (${response.status})`));
      setNotice({ tone: "ok", text: c(`${task.title} moved to ${label(status, locale)}.`, `${task.title} → ${label(status, locale)} durumuna alındı.`) });
      setReasonEditor(null);
      refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Task update failed.", "Görev güncellenemedi.") });
    } finally { inFlight.current = false; setPending(null); }
  }
  async function activateEmployment(planId: string, person: string) {
    const plan = view.plans.find((item) => item.id === planId);
    if (inFlight.current || busy || !snapshot.canActivate || !plan?.ready) return;
    if (!window.confirm(c(`Activate employment for ${person}? The server will recheck authority, both start dates and every task.`, `${person} için istihdam aktifleştirilsin mi? Sunucu yetkiyi, her iki başlangıç tarihini ve tüm görevleri yeniden kontrol edecek.`))) return;
    inFlight.current = true;
    setPending(`activate-${planId}`);
    setNotice(null);
    try {
      const response = await fetch(`/api/onboarding/plans/${encodeURIComponent(planId)}/activate`, { method: "POST", credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`, `İstek başarısız (${response.status})`));
      setNotice({ tone: "ok", text: c(`${person} is now an active employee.`, `${person} artık aktif çalışan durumunda.`) });
      refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Employment activation failed.", "İstihdam aktifleştirilemedi.") });
    } finally { inFlight.current = false; setPending(null); }
  }
  function requestTransition(task: ReadinessTask, status: string) {
    if (status === "BLOCKED" || status === "WAIVED") { setReasonEditor({ taskId: task.id, status, text: "" }); return; }
    void changeStatus(task, status);
  }
  function date(value: string | null) {
    return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB") : c("Not set", "Belirlenmemiş");
  }
  const issueLabels: Record<ReadinessIssue, string> = {
    incomplete: c("Task list is incomplete; activation is withheld.", "Görev listesi eksik; aktivasyon gösterilmiyor."),
    "no-tasks": c("No tasks defined. Review the plan; it is not verified as ready.", "Görev tanımlanmamış. Planı gözden geçirin; hazır kabul edilmez."),
    unlinked: c("Employment is not linked.", "İstihdam kaydı bağlı değil."),
    dates: c("A required start date is missing or invalid.", "Gerekli bir başlangıç tarihi eksik veya geçersiz."),
    "unknown-state": c("An unrecognized state needs review.", "Tanınmayan bir durum incelenmeli."),
    "state-mismatch": c("Plan status and task readiness disagree. Review the source records.", "Plan durumu ve görev hazırlığı tutarsız. Kaynak kayıtları inceleyin."),
    unscheduled: c("Open tasks lack a valid due date.", "Açık görevlerde geçerli son tarih eksik.")
  };
  const filters: Array<[ReadinessFilter, string]> = [["all", c("All plans", "Tüm planlar")], ["blocked", c("Blocked", "Engel var")],
    ["overdue", c("Overdue", "Gecikmiş")], ["start-risk", c("Start-date risk", "Başlangıç riski")], ["ready", c("Ready now", "Şimdi hazır")],
    ["waiting", c("Waiting for start date", "Başlangıç tarihini bekliyor")], ["review", c("Needs review", "İnceleme gerekiyor")]];

  return <section className={`onb-console card ${styles.console}`} aria-busy={busy}>
    <div className="onb-console-head"><div><span className="section-kicker">{c("Controlled onboarding execution", "Kontrollü işe başlatma yürütümü")}</span><h3>{c("Day-one readiness console", "İlk gün hazırlık konsolu")}</h3><p>{c("See what blocks each start. Filters keep the whole plan visible; completion and waivers remain distinct. Activation is always rechecked by the server.", "Her başlangıcı neyin engellediğini görün. Filtreler planın tamamını korur; tamamlanan ve muaf görevler ayrı gösterilir. Aktivasyon her zaman sunucuda yeniden kontrol edilir.")}</p></div><button type="button" className="secondary-button" disabled={busy} onClick={refresh}><RefreshCw size={15}/>{c("Refresh", "Yenile")}</button></div>
    <div className="recruit-metrics">
      <RiskMetric labelText={c("Plans in queue", "Kuyruktaki planlar")} value={view.summary.plans} note={c("Loaded plans, including empty plans", "Boş planlar dahil yüklenen planlar")} icon={ClipboardCheck}/>
      <RiskMetric labelText={c("Blocked tasks", "Engelli görevler")} value={view.summary.blocked} note={c("Explicit blocker state", "Açık engel durumu")} icon={CircleAlert} risk/>
      <RiskMetric labelText={c("Overdue tasks", "Gecikmiş görevler")} value={view.summary.overdue} note={c("Open task past due date", "Son tarihi geçmiş açık görev")} icon={Clock3} risk/>
      <RiskMetric labelText={c("Start-date risk", "Başlangıç tarihi riski")} value={view.summary.startRisk} note={c(`Open plans within ${view.startRiskHours} hours or past start`, `${view.startRiskHours} saat içinde veya başlangıcı geçmiş açık planlar`)} icon={Clock3} risk/>
      <RiskMetric labelText={c("Ready to activate", "Aktivasyona hazır")} value={view.summary.ready} note={c("Complete tasks; both start dates reached", "Görevler kapalı; iki başlangıç tarihi de gelmiş")} icon={UserCheck}/>
      <RiskMetric labelText={c("Waiting for start date", "Başlangıç tarihini bekliyor")} value={view.summary.waiting} note={c("Ready tasks; activation not yet due", "Görevler hazır; aktivasyon tarihi gelmemiş")} icon={Clock3}/>
    </div>
    <p className={styles.note}>{c("Counts describe only the loaded snapshot, not the entire organization. Missing due dates are not inferred from policy.", "Sayılar yalnızca yüklenen veri kümesini gösterir; kurum toplamı değildir. Eksik son tarihler politikadan varsayılmaz.")}</p>
    {snapshot.hasMorePlans ? <p className={`ats-notice error ${styles.note}`} role="status">{c(`Only the first ${snapshot.planLimit} scoped plans are loaded. Additional plans are not included in these counts or filters.`, `Kapsamınızdaki ilk ${snapshot.planLimit} plan yüklendi. Diğer planlar bu sayılara veya filtrelere dahil değil.`)}</p> : null}
    <div className={styles.filters}>
      <label>{c("Search employee or task", "Çalışan veya görev ara")}<input type="search" maxLength={200} value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(20); }} placeholder={c("Name, employee number, task", "Ad, çalışan numarası, görev")}/></label>
      <label>{c("Readiness", "Hazırlık")}<select value={filter} onChange={(event) => { setFilter(event.target.value as ReadinessFilter); setVisibleCount(20); }}>{filters.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <label>{c("Responsible team type", "Sorumlu ekip türü")}<select value={owner} onChange={(event) => { setOwner(event.target.value); setVisibleCount(20); }}><option value="">{c("All teams", "Tüm ekipler")}</option>{owners.map((value) => <option key={value} value={value}>{label(value, locale)}</option>)}</select></label>
      <button type="button" className="secondary-button" onClick={clearFilters}>{c("Clear filters", "Filtreleri temizle")}</button>
    </div>
    <p className={styles.note} role="status" aria-live="polite">{c(`${visible.length} of ${filtered.length} matching plans shown · ${view.summary.review} loaded plans need review`, `${filtered.length} eşleşen plandan ${visible.length} tanesi gösteriliyor · Yüklenen ${view.summary.review} plan incelenmeli`)}</p>
    {notice ? <div className={`ats-notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}
    {hasNotificationContext ? <div className={`ats-notice ${focusVisible ? "ok" : "error"}`} role="status">{focusVisible ? c("Notification target is highlighted below.", "Bildirim hedefi aşağıda vurgulandı.") : notificationContextResolved ? c("The target is loaded but hidden by filters. Clear filters to reveal it.", "Hedef yüklendi fakat filtrelerle gizlendi. Göstermek için filtreleri temizleyin.") : c("The target is not in this loaded, authorized snapshot. It may be outside the result limit, outside your scope or no longer active. No broader query was used.", "Hedef bu yüklenen, yetkili veri kümesinde değil. Sonuç sınırı dışında, yetkiniz dışında veya artık aktif olmayabilir. Daha geniş sorgu kullanılmadı.")}</div> : null}
    <div className="onb-plan-list">{visible.map((plan) => {
      const planId = plan.id;
      const readinessRisk = plan.blocked > 0 || plan.overdue > 0 || plan.startRisk || plan.needsReview;
      const planFocused = focused?.id === planId;
      return <article id={`onboarding-plan-${planId}`} key={planId} className={`onb-plan ${planFocused ? styles.focused : ""} ${readinessRisk ? "onb-plan-risk" : ""}`}>
        <header><div><strong>{plan.person}</strong><small>{plan.employeeNumber} · {label(plan.planStatus, locale)} · {plan.employmentStatus ? label(plan.employmentStatus, locale) : c("Employment not linked", "İstihdam bağlı değil")}</small><small>{c("Planned start", "Planlanan başlangıç")}: {date(plan.targetStartDate)} · {c("Employment start", "İstihdam başlangıcı")}: {date(plan.employmentStartDate)}</small></div>
          <div className={styles.planActions}><span>{plan.completed} {c("completed", "tamamlandı")} · {plan.waived} {c("waived", "muaf")} · {plan.totalTasks} {c("total", "toplam")}</span>
            <span className={readinessRisk ? styles.risk : undefined}>{plan.blocked ? `${plan.blocked} ${c("blocked", "engelli")} · ` : ""}{plan.overdue ? `${plan.overdue} ${c("overdue", "gecikmiş")} · ` : ""}{plan.startRisk ? c(`Start risk ≤${view.startRiskHours}h`, `Başlangıç riski ≤${view.startRiskHours} saat`) : ""}</span>
            {plan.waiting ? <span>{c("Waiting for the later start date", "İki başlangıç tarihinin de gelmesi bekleniyor")}</span> : null}
            {plan.ready && snapshot.canActivate ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void activateEmployment(planId, plan.person)}><UserCheck size={14}/>{c("Activate employee", "Çalışanı aktifleştir")}</button> : null}
            {plan.ready && !snapshot.canActivate ? <span><LockKeyhole size={13}/> {c("People write authority required for activation", "Aktivasyon için çalışan kaydı yazma yetkisi gerekli")}</span> : null}
          </div>
        </header>
        {plan.issues.length ? <div className={styles.issues}>{plan.issues.map((issue) => <p key={issue}><CircleAlert size={14}/>{issueLabels[issue]}</p>)}{plan.incomplete ? <p>{c(`Loaded ${plan.tasks.length} of ${plan.totalTasks} tasks (limit ${snapshot.taskLimit}).`, `${plan.totalTasks} görevden ${plan.tasks.length} tanesi yüklendi (sınır ${snapshot.taskLimit}).`)}</p> : null}</div> : null}
        <div className="onb-task-list">{plan.tasks.map((task) => {
          const taskFocused = focusedTaskId === task.id;
          const taskOverdue = !terminalTaskStatuses.has(task.status) && Boolean(task.dueDate) && Date.parse(task.dueDate as string) < now;
          return <div id={`onboarding-task-${task.id}`} key={task.id} className={`onb-task ${taskFocused ? styles.focused : ""}`}>
            <div className="onb-task-copy">{task.sensitive ? <LockKeyhole size={13}/> : terminalTaskStatuses.has(task.status) ? <CheckCircle2 size={13}/> : <ClipboardCheck size={13}/>}<span><strong>{task.title}</strong><small className={taskOverdue ? styles.risk : undefined}>{label(task.ownerType, locale)} · {task.dueDate ? `${c("Due", "Son tarih")} ${date(task.dueDate)}` : c("Due date not set", "Son tarih belirlenmemiş")}{taskOverdue ? ` · ${c("OVERDUE", "GECİKMİŞ")}` : ""}</small></span></div>
            <em className={`pill ${task.status.toLowerCase().replaceAll("_", "-")}`}>{label(task.status, locale)}</em>
            <div className="ats-actions">{(transitions[task.status] ?? []).map((next) => <button type="button" key={next} disabled={busy} onClick={() => requestTransition(task, next)}>{pending === `${task.id}-${next}` ? "…" : label(next, locale)}</button>)}</div>
            {reasonEditor?.taskId === task.id ? <div className={styles.reasonEditor}><label>{reasonEditor.status === "WAIVED" ? c("Waiver reason", "Muafiyet gerekçesi") : c("Blocker reason", "Engel gerekçesi")}<textarea maxLength={500} autoFocus value={reasonEditor.text} onChange={(event) => setReasonEditor({ ...reasonEditor, text: event.target.value })} placeholder={c("Explain the reason and operational impact.", "Gerekçeyi ve operasyonel etkiyi açıklayın.")}/></label><div className="ats-actions"><button type="button" disabled={busy || !reasonEditor.text.trim()} onClick={() => void changeStatus(task, reasonEditor.status, reasonEditor.text.trim())}>{c("Confirm", "Onayla")}</button><button type="button" disabled={busy} onClick={() => setReasonEditor(null)}>{c("Cancel", "Vazgeç")}</button></div></div> : null}
          </div>;
        })}</div>
      </article>;
    })}</div>
    {!filtered.length ? <p className={styles.empty}>{view.plans.length ? c("No plans match these filters. Clear filters to see the loaded plans.", "Bu filtrelere uyan plan yok. Yüklenen planları görmek için filtreleri temizleyin.") : c("No active plans were returned in your authorized scope.", "Yetkili kapsamınızda aktif plan bulunamadı.")}</p> : null}
    {visible.length < filtered.length ? <button className="secondary-button" type="button" onClick={() => setVisibleCount((value) => value + 20)}>{c("Show next 20 loaded plans", "Yüklenen sonraki 20 planı göster")}</button> : null}
  </section>;
}
