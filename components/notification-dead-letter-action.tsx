"use client";
import styles from "@/components/notification-operations.module.css";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { useNotificationRetry, useOperationsRead } from "@/components/use-notification-operations";
import { retrySnapshot, type RetrySnapshot } from "@/lib/notification-retry-contract";
export function NotificationDeadLetterAction({ count }: { count: number }) {
  const { locale } = useLocale(), tr = locale === "tr";
  const [preview, setPreview] = useState(false);
  const read = useOperationsRead("DEAD_LETTER", 100, preview), action = useNotificationRetry(tr);
  const items = read.data?.items.map(retrySnapshot).filter((i): i is RetrySnapshot => Boolean(i)) ?? [];
  async function retry() {
    const phase = await action.run("DEAD_LETTER_BATCH", items, read.current);
    if (phase === "denied") read.invalidate();
  }
  if (!action.allowed) return null;
  return <div className={`settings-notification-action ${styles.batch}`} data-notification-batch>
    {!preview ? <button type="button" className="secondary-button" disabled={count <= 0 || action.pending} onClick={() => setPreview(true)}>
      {tr ? "Dead-letter yeniden denemeyi hazırla" : "Prepare dead-letter retry"}</button> : <>
      {read.loading ? <p role="status">{tr ? "İncelenecek kayıtlar yükleniyor…" : "Loading records for review…"}</p> : null}
      {read.error ? <p role="alert">{tr ? "Önizleme doğrulanamadı. Yeniden okuyun." : "Preview could not be verified. Read it again."}</p> : null}
      {read.data ? <><p>{tr ? `${items.length} kayıt önizlendi. Yalnız aşağıdaki kayıtlar işlenecek; biri değişirse tüm işlem iptal edilir.` : `${items.length} records previewed. Only the rows below will be processed; a changed record cancels the entire command.`}</p>
        <details><summary>{tr ? "İncelenen kayıtlar" : "Reviewed records"}</summary>{read.data.items.map(item => <p key={item.id}>{item.eventType} · {item.channel} · {item.resourceId}</p>)}</details>
        <button type="button" className="secondary-button" disabled={action.blocked(items) || read.loading} onClick={() => void retry()}>{tr ? "İncelenen kayıtları yeniden kuyruğa al" : "Requeue reviewed records"}</button></> : null}
      <button type="button" className="secondary-button compact" disabled={read.loading || action.pending} onClick={() => void read.load()}>{tr ? "Önizlemeyi yenile" : "Refresh preview"}</button>
      <button type="button" className="secondary-button compact" disabled={action.pending} onClick={() => setPreview(false)}>{tr ? "Önizlemeyi kapat" : "Close preview"}</button>
    </>}
    {action.message ? <p role={action.phase === "saved" ? "status" : "alert"}>{action.message}</p> : null}
  </div>;
}
