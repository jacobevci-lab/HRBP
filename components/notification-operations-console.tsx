"use client";
import styles from "@/components/notification-operations.module.css";
import { useState } from "react";
import { useSessionContext } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { useNotificationRetry, useOperationsRead } from "@/components/use-notification-operations";
import { operationalStates, retrySnapshot, type OpsItem } from "@/lib/notification-retry-contract";

export function NotificationOperationsConsole({ canWrite }: { canWrite: boolean }) {
  const { locale } = useLocale(), tr = locale === "tr";
  const [filter, setFilter] = useState("ALL");
  const { session } = useSessionContext();
  const owner = JSON.stringify([session?.user?.id, session?.user?.tenantId, session?.user?.role]);
  const [position, setPosition] = useState<{ owner: string; filter: string; after: string; number: number } | null>(null);
  const selected = position?.owner === owner && position.filter === filter ? position : null;
  const read = useOperationsRead(filter, 100, true, selected?.after ?? null), action = useNotificationRetry(tr, canWrite);
  const labels: Record<string, string> = tr
    ? { ALL: "Tüm açık kayıtlar", PENDING: "Bekliyor", PROCESSING: "İşleniyor", FAILED: "Başarısız", DEAD_LETTER: "Otomatik denemeler durdu" }
    : { ALL: "All open", PENDING: "Pending", PROCESSING: "Processing", FAILED: "Failed", DEAD_LETTER: "Automatic retries stopped" };
  const counts = read.data?.counts;
  const countFor = (state: string) => !counts ? "—" : state === "ALL" ? counts.pending + counts.processing + counts.failed + counts.deadLetter
    : state === "PENDING" ? counts.pending : state === "PROCESSING" ? counts.processing : state === "FAILED" ? counts.failed : counts.deadLetter;
  const fmt = (value: string) => new Intl.DateTimeFormat(tr ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  async function retry(item: OpsItem) {
    const snapshot = retrySnapshot(item);
    if (!snapshot) return;
    const phase = await action.run("SINGLE", [snapshot], read.current);
    if (phase === "denied") read.invalidate();
    else if (phase === "saved") await read.load();
  }
  function firstPage() {
    if (action.pending) return;
    if (selected) setPosition(null);
    else void read.load();
  }
  function olderPage() {
    if (!read.current() || !read.page?.next || action.pending) return;
    setPosition({ owner, filter, after: read.page.next, number: (selected?.number ?? 1) + 1 });
  }
  if (!read.allowed) return null;
  return <section className={`card settings-live-panel notification-ops-console ${styles.console}`} data-notification-operations>
    <div className="settings-live-panel-head"><div>
      <span className="section-kicker">{tr ? "Bildirim operasyonları" : "Notification operations"}</span>
      <h3>{tr ? "Gönderim kuyruğu ve yeniden deneme" : "Delivery queue and retry"}</h3>
      <p>{tr ? "Yalnız incelenen kayıtlar yeniden kuyruğa alınır; bu, e-postanın teslim edildiği anlamına gelmez." : "Only reviewed records are requeued; this does not mean an email was delivered."}</p>
    </div><button type="button" className="secondary-button compact" onClick={firstPage} disabled={read.loading || action.pending}>{tr ? "Yenile" : "Refresh"}</button></div>
    <div className="notification-ops-metrics">{["ALL", ...operationalStates].map(state => <button type="button" key={state} aria-pressed={filter === state} disabled={action.pending}
      className={filter === state ? "active" : ""} onClick={() => { setPosition(null); setFilter(state); }}><span>{labels[state]}</span><strong>{countFor(state)}</strong></button>)}</div>
    {action.message ? <p role={action.phase === "saved" ? "status" : "alert"} className="settings-policy-message">{action.message}</p> : null}
    {read.error ? <p role="alert">{tr ? "Kayıtlar doğrulanamadı. Eski liste gizlendi; yeniden okumak için Yenile’ye basın." : "Records could not be verified. Old rows are hidden; press Refresh to read again."}</p> : null}
    <div className="settings-live-table-wrap"><table className="settings-live-table notification-ops-table"><thead><tr>
      {[tr ? "Olay" : "Event", tr ? "Kaynak" : "Resource", tr ? "Durum" : "Status", tr ? "Deneme" : "Attempts", tr ? "Sonraki deneme (UTC)" : "Next attempt (UTC)", tr ? "Son hata" : "Last error", tr ? "İşlem" : "Operation"].map(t => <th key={t}>{t}</th>)}
    </tr></thead><tbody>
      {read.loading ? <tr><td colSpan={7}>{tr ? "Kayıtlar yükleniyor…" : "Loading records…"}</td></tr> : null}
      {read.data && !read.data.items.length ? <tr><td colSpan={7}>{tr ? "Bu görünümde kayıt yok." : "No records in this view."}</td></tr> : null}
      {read.data?.items.map(item => { const snapshot = retrySnapshot(item); return <tr key={item.id} data-notification-row={item.id}>
        <td><strong>{item.eventType}</strong><small>{item.channel} · {fmt(item.updatedAt)}</small></td>
        <td><strong>{item.resourceType}</strong><small>{item.resourceId}</small></td><td>{labels[item.status]}</td><td>{item.attempts}</td><td>{fmt(item.nextAttemptAt)}</td>
        <td>{item.lastError === "DELIVERY_ERROR_REDACTED" ? (tr ? "Sağlayıcı ayrıntıları gizlendi" : "Provider details redacted") : item.lastError ?? "—"}</td>
        <td>{action.allowed && snapshot ? <button type="button" className="secondary-button compact" disabled={action.blocked([snapshot]) || read.loading} onClick={() => void retry(item)}>{tr ? "Yeniden dene" : "Retry"}</button> : "—"}</td>
      </tr>; })}
    </tbody></table></div>
    <nav className={styles.pagination} aria-label={tr ? "Bildirim sayfaları" : "Notification pages"}>
      <span role="status">{tr ? `Sayfa ${selected?.number ?? 1}` : `Page ${selected?.number ?? 1}`}{read.data ? ` · ${read.data.items.length} ${tr ? "kayıt" : "records"}` : ""}</span>
      <div><button type="button" className="secondary-button compact" disabled={!selected || read.loading || action.pending} onClick={firstPage}>{tr ? "İlk sayfa" : "First page"}</button>
      <button type="button" className="secondary-button compact" disabled={!read.page?.next || read.loading || action.pending} onClick={olderPage}>{tr ? "Daha eski kayıtlar" : "Older records"}</button></div>
    </nav>
    {read.data && !read.page?.next ? <p className="settings-live-footnote">{tr ? "Bu okumada daha eski kayıt bulunamadı." : "No older records were found in this read."}</p> : null}
    <p className="settings-live-footnote">{tr ? "Sayaçlar kurum toplamıdır; her sayfa en fazla 100 kayıt gösterir. Canlı kuyruk değiştikçe kayıtlar sayfalar arasında yer değiştirebilir; Yenile ilk sayfayı açar. Bildirim payload verisi gösterilmez. Tarihler UTC’dir." : "Counters are tenant totals; each page shows up to 100 records. Live queue changes can move records between pages; Refresh returns to the first page. Notification payload data is never projected here. Dates use UTC."}</p>
  </section>;
}
