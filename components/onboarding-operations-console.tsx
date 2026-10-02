"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/components/locale-provider";
import { OnboardingOperationsConsole as ReadinessConsole } from "@/components/onboarding-readiness-console";
import { OnboardingTaskPlanningConsole } from "@/components/onboarding-task-planning-console";
import { parseOnboardingOperationsQuery } from "@/lib/onboarding-operations-query.mjs";
import type { OnboardingOperationsSnapshot } from "@/lib/onboarding-operations-data";
import styles from "./onboarding-readiness.module.css";

type Selection = { query: string; focus: string; previous: string[]; number: number };
type Result = { source: OnboardingOperationsSnapshot; query: string; revision: number; data: OnboardingOperationsSnapshot | null; error: number | null };

function OperationsBrowser({ tasks }: { tasks: OnboardingOperationsSnapshot }) {
  const { locale } = useLocale();
  const router = useRouter();
  const search = useSearchParams();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  // Preserve duplicates so malformed notification links are rejected, not broadened.
  const focusParams = new URLSearchParams();
  for (const key of ["plan", "task"]) for (const value of search.getAll(key)) focusParams.append(key, value);
  const focus = focusParams.toString();
  const [selection, setSelection] = useState<Selection>(() => ({ query: focus, focus, previous: [], number: 1 }));
  const [revision, setRevision] = useState(0);
  const [planning, setPlanning] = useState(false);
  const [result, setResult] = useState<Result>(() => ({ source: tasks, query: "", revision: 0, data: tasks, error: null }));

  useEffect(() => {
    setSelection((value) => value.focus === focus ? value : { query: focus, focus, previous: [], number: 1 });
  }, [focus]);

  useEffect(() => {
    if (selection.focus !== focus) return;
    let valid = true;
    try { parseOnboardingOperationsQuery(new URLSearchParams(selection.query)); } catch { valid = false; }
    const base = { source: tasks, query: selection.query, revision };
    if (!valid) { setResult({ ...base, data: null, error: 400 }); return; }
    if (!selection.query && revision === 0) { setResult({ ...base, data: tasks, error: null }); return; }

    let live = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    // A new query or refreshed server snapshot must not display old actionable records.
    setResult({ ...base, data: null, error: null });
    void (async () => {
      try {
        const response = await fetch(`/api/onboarding/operations${selection.query ? `?${selection.query}` : ""}`, {
          credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal
        });
        if (!response.ok) {
          if (live) setResult({ ...base, data: null, error: response.status });
          return;
        }
        const body = await response.json() as { data?: OnboardingOperationsSnapshot };
        const data = body.data;
        const expected = parseOnboardingOperationsQuery(new URLSearchParams(selection.query));
        if (!data || data.page?.version !== 1 || data.page.mode !== expected.mode || !data.page.resolved ||
            !Array.isArray(data.plans) || !Array.isArray(data.tasks) || !Number.isFinite(Date.parse(data.generatedAt))) throw new Error("INVALID_PAGE");
        if (live) setResult({ ...base, data, error: null });
      } catch {
        if (live) setResult({ ...base, data: null, error: 503 });
      } finally { window.clearTimeout(timer); }
    })();
    return () => { live = false; controller.abort(); window.clearTimeout(timer); };
  }, [tasks, selection.query, selection.focus, focus, revision]);

  const current = result.source === tasks && result.query === selection.query && result.revision === revision && selection.focus === focus;
  const data = current ? result.data : null;
  const error = current ? result.error : null;
  const loading = !data && error === null;
  const focusedMode = Boolean(focus);
  function navigate(query: string, previous: string[], number: number) {
    setSelection({ query, previous, number, focus });
    setRevision((value) => value + 1);
  }
  function returnToQueue() {
    const params = new URLSearchParams(search.toString());
    params.delete("task"); params.delete("plan");
    router.replace(`/module/onboarding${params.size ? `?${params}` : ""}`, { scroll: false });
  }
  const message = error === 400 ? c("This onboarding link or page cursor is invalid.", "İşe başlatma bağlantısı veya sayfa bilgisi geçersiz.")
    : error === 401 || error === 403 ? c("Your session or onboarding authority changed. Sign in or refresh your access.", "Oturumunuz veya işe başlatma yetkiniz değişti. Girişinizi ve erişiminizi yenileyin.")
    : error === 404 ? c("This record is not available in your active onboarding scope. No substitute records were loaded.", "Bu kayıt aktif işe başlatma kapsamınızda kullanılamıyor. Yerine başka kayıt yüklenmedi.")
    : c("Records could not be refreshed. Previous action controls are hidden; retry when the service is available.", "Kayıtlar yenilenemedi. Önceki işlem kontrolleri gizlendi; hizmet kullanılabilir olduğunda yeniden deneyin.");

  return <>
    <section className={`card ${styles.console}`} aria-busy={loading}>
      <div className={styles.planActions}>
        <strong>{focusedMode ? c("Notification record", "Bildirim kaydı") : c(`Plan page ${selection.number}`, `Plan sayfası ${selection.number}`)}</strong>
        {focusedMode ? <button type="button" className="secondary-button" disabled={planning} onClick={returnToQueue}>{c("Return to plan queue", "Plan kuyruğuna dön")}</button> : <>
          <button type="button" className="secondary-button" disabled={planning || loading || !selection.previous.length} onClick={() => navigate(selection.previous.at(-1) ?? "", selection.previous.slice(0, -1), Math.max(1, selection.number - 1))}>{c("Previous page", "Önceki sayfa")}</button>
          <button type="button" className="secondary-button" disabled={planning || loading || !data?.page.nextCursor} onClick={() => {
            if (data?.page.nextCursor) navigate(new URLSearchParams({ after: data.page.nextCursor }).toString(), [...selection.previous, selection.query], selection.number + 1);
          }}>{c("Next page", "Sonraki sayfa")}</button>
          <button type="button" className="secondary-button" disabled={planning || loading} onClick={() => navigate("", [], 1)}>{c("Restart queue", "Kuyruğu baştan yükle")}</button>
        </>}
        <button type="button" className="secondary-button" disabled={planning || loading} onClick={() => setRevision((value) => value + 1)}>{c("Reload this page", "Bu sayfayı yenile")}</button>
      </div>
      <p className={styles.note}>{c("Each page reloads your current access scope. Counts, team filters, search and risk ordering apply only to this page, not all pages. Pages replace previous data rather than accumulating records.", "Her sayfada güncel erişim kapsamınız yeniden kontrol edilir. Sayılar, ekip filtreleri, arama ve risk sıralaması yalnızca bu sayfaya aittir. Yeni sayfa öncekinin yerini alır; kayıtlar biriktirilmez.")}</p>
      {data?.hasMorePlans ? <p className={styles.note} role="status">{c("More authorized plans are available on the next page. A filter with no matches here does not mean the whole queue is empty.", "Sonraki sayfada başka yetkili planlar var. Burada filtre sonucu bulunamaması tüm kuyruğun boş olduğu anlamına gelmez.")}</p> : null}
      {focusedMode ? <p className={styles.note}>{c("The exact plan/task is retrieved using the same active-plan and relationship scope. A task beyond the display limit is pinned, but its incomplete plan remains blocked from activation.", "Tam plan/görev aynı aktif plan ve ilişki kapsamıyla sorgulanır. Görüntüleme sınırı dışındaki görev sabitlenir; eksik görev listesi olan plan aktifleştirilemez.")}</p> : null}
      {loading ? <p role="status" aria-live="polite">{c("Loading authorized records…", "Yetkili kayıtlar yükleniyor…")}</p> : null}
      {error !== null ? <p role="alert" className="ats-notice error">{message}</p> : null}
    </section>
    {/* Pagination disclosure belongs to this browser. Suppress only the legacy
        first-snapshot overflow notice; retain every task/completeness warning. */}
    {data ? <OnboardingTaskPlanningConsole key={`planning:${selection.query}:${revision}:${data.generatedAt}`} snapshot={data} onBusyChange={setPlanning} onSaved={() => setRevision((value) => value + 1)}/> : null}
    <fieldset disabled={planning} aria-busy={planning} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    {data ? <ReadinessConsole key={`${selection.query}:${revision}:${data.generatedAt}`} tasks={{ ...data, hasMorePlans: false }}/> : null}
    </fieldset>
  </>;
}

export function OnboardingOperationsConsole(props: { tasks: OnboardingOperationsSnapshot }) {
  return <Suspense fallback={<div className="card" role="status">…</div>}><OperationsBrowser {...props}/></Suspense>;
}
