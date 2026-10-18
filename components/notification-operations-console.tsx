"use client";
import styles from "@/components/notification-operations.module.css";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { useNotificationRetry, useOperationsRead } from "@/components/use-notification-operations";
import { operationalStates, retrySnapshot, type OpsItem } from "@/lib/notification-retry-contract";

export function NotificationOperationsConsole({ canWrite }: { canWrite: boolean }) {
  const { locale } = useLocale(), tr = locale === "tr";
  const [filter, setFilter] = useState("ALL");
  const read = useOperationsRead(filter, 100), action = useNotificationRetry(tr, canWrite);
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
  if (!read.allowed) return null;
  return <section className={`card settings-live-panel notification-ops-console ${styles.console}`} data-notification-operations>
    <div className="settings-live-panel-head"><div>
      <span className="section-kicker">{tr ? "Bildirim operasyonları" : "Notification operations"}</span>
      <h3>{tr ? "Gönderim kuyruğu ve yeniden deneme" : "Delivery queue and retry"}</h3>
      <p>{tr ? "Yalnız incelenen kayıtlar yeniden kuyruğa alınır; bu, e-postanın teslim edildiği anlamına gelmez." : "Only reviewed records are requeued; this does not mean an email was delivered."}</p>
    </div><button type="button" className="secondary-button compact" onClick={() => void read.load()} disabled={read.loading || action.pending}>{tr ? "Yenile" : "Refresh"}</button></div>
    <div className="notification-ops-metrics">{["ALL", ...operationalStates].map(state => <button type="button" key={state} aria-pressed={filter === state} disabled={action.pending}
      className={filter === state ? "active" : ""} onClick={() => setFilter(state)}><span>{labels[state]}</span><strong>{countFor(state)}</strong></button>)}</div>
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
    <p className="settings-live-footnote">{tr ? "Sayaçlar kurum toplamıdır; liste seçilen durumdaki son 100 kayıtla sınırlıdır. Bildirim payload verisi bu ekrana taşınmaz. Gösterilen tarihler UTC’dir." : "Counters are tenant totals; the list contains the latest 100 records for the selected status. Notification payload data is never projected here. Dates use UTC."}</p>
  </section>;
}
