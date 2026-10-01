"use client";

import { AlertTriangle, Clock3, RefreshCw, RotateCcw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";

type OpsItem = {
  id: string;
  eventType: string;
  channel: string;
  resourceType: string;
  resourceId: string;
  status: "PENDING" | "PROCESSING" | "FAILED" | "DEAD_LETTER";
  attempts: number;
  nextAttemptAt: string;
  lockedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type OpsResponse = {
  data?: {
    counts: {
      pending: number;
      processing: number;
      failed: number;
      deadLetter: number;
      delivered: number;
    };
    items: OpsItem[];
  };
  error?: string;
};

type Filter = "ALL" | OpsItem["status"];

export function NotificationOperationsConsole({ canWrite }: { canWrite: boolean }) {
  const { locale } = useLocale();
  const tr = locale === "tr";
  const [items, setItems] = useState<OpsItem[]>([]);
  const [counts, setCounts] = useState({ pending: 0, processing: 0, failed: 0, deadLetter: 0, delivered: 0 });
  const [filter, setFilter] = useState<Filter>("ALL");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/notifications/operations?limit=100", { cache: "no-store" });
      const body = await response.json() as OpsResponse;
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setItems(body.data?.items ?? []);
      setCounts(body.data?.counts ?? { pending: 0, processing: 0, failed: 0, deadLetter: 0, delivered: 0 });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : (tr ? "Bildirim operasyonları yüklenemedi." : "Notification operations could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => filter === "ALL" ? items : items.filter((item) => item.status === filter), [filter, items]);

  function fmt(value: string | null) {
    if (!value) return "—";
    return new Intl.DateTimeFormat(tr ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }

  async function retry(item: OpsItem) {
    if (!canWrite || !["FAILED", "DEAD_LETTER"].includes(item.status)) return;
    const confirmed = window.confirm(tr
      ? `${item.eventType} bildirimi yeniden kuyruğa alınsın mı?`
      : `Requeue ${item.eventType} notification?`);
    if (!confirmed) return;

    setBusyId(item.id);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/notifications/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id })
      });
      const body = await response.json() as { data?: { requeued?: number }; error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setMessage(tr ? "Bildirim yeniden kuyruğa alındı." : "Notification requeued.");
      await load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : (tr ? "Yeniden kuyruğa alma başarısız." : "Requeue failed."));
    } finally {
      setBusyId(null);
    }
  }

  return <section className="card settings-live-panel notification-ops-console">
    <div className="settings-live-panel-head">
      <div>
        <span className="section-kicker">{tr ? "Bildirim operasyonları" : "Notification operations"}</span>
        <h3>{tr ? "Outbox hata ve teslim kuyruğu" : "Outbox failure & delivery queue"}</h3>
        <p>{tr ? "Aktif teslim kuyruğunu, başarısızlıkları ve dead-letter kayıtlarını payload içeriğini açığa çıkarmadan yönetin." : "Operate active delivery work, failures and dead letters without exposing notification payload content."}</p>
      </div>
      <button type="button" className="secondary-button compact" onClick={() => void load()} disabled={loading}><RefreshCw size={14}/>{tr ? "Yenile" : "Refresh"}</button>
    </div>

    <div className="notification-ops-metrics">
      <button type="button" className={filter === "PENDING" ? "active" : ""} onClick={() => setFilter("PENDING")}><Clock3 size={15}/><span>PENDING</span><strong>{counts.pending}</strong></button>
      <button type="button" className={filter === "PROCESSING" ? "active" : ""} onClick={() => setFilter("PROCESSING")}><RefreshCw size={15}/><span>PROCESSING</span><strong>{counts.processing}</strong></button>
      <button type="button" className={filter === "FAILED" ? "active attention" : "attention"} onClick={() => setFilter("FAILED")}><AlertTriangle size={15}/><span>FAILED</span><strong>{counts.failed}</strong></button>
      <button type="button" className={filter === "DEAD_LETTER" ? "active danger" : "danger"} onClick={() => setFilter("DEAD_LETTER")}><ShieldAlert size={15}/><span>DEAD LETTER</span><strong>{counts.deadLetter}</strong></button>
      <button type="button" className={filter === "ALL" ? "active" : ""} onClick={() => setFilter("ALL")}><span>{tr ? "TÜM AÇIK" : "ALL OPEN"}</span><strong>{items.length}</strong></button>
    </div>

    {message ? <div className="settings-policy-message">{message}</div> : null}

    <div className="settings-live-table-wrap">
      <table className="settings-live-table notification-ops-table">
        <thead><tr><th>{tr ? "Olay" : "Event"}</th><th>{tr ? "Kaynak" : "Resource"}</th><th>{tr ? "Durum" : "Status"}</th><th>{tr ? "Deneme" : "Attempts"}</th><th>{tr ? "Sonraki deneme" : "Next attempt"}</th><th>{tr ? "Son hata" : "Last error"}</th><th>{tr ? "İşlem" : "Operation"}</th></tr></thead>
        <tbody>
          {loading && !items.length ? <tr><td colSpan={7} className="settings-live-empty">{tr ? "Operasyon kayıtları yükleniyor…" : "Loading operational records…"}</td></tr> : null}
          {!loading && !visible.length ? <tr><td colSpan={7} className="settings-live-empty">{tr ? "Bu görünümde açık bildirim operasyonu yok." : "No open notification operations in this view."}</td></tr> : null}
          {visible.map((item) => <tr key={item.id}>
            <td><strong>{item.eventType}</strong><small>{item.channel} · {fmt(item.updatedAt)}</small></td>
            <td><strong>{item.resourceType}</strong><small>{item.resourceId}</small></td>
            <td><span className={`settings-live-state ${item.status === "FAILED" || item.status === "DEAD_LETTER" ? "attention" : "ok"}`}>{item.status.replaceAll("_", " ")}</span></td>
            <td>{item.attempts}</td>
            <td>{fmt(item.nextAttemptAt)}</td>
            <td><span className="notification-ops-error">{item.lastError ?? "—"}</span></td>
            <td>{canWrite && (item.status === "FAILED" || item.status === "DEAD_LETTER") ? <button type="button" className="secondary-button compact" disabled={busyId === item.id} onClick={() => void retry(item)}><RotateCcw size={13}/>{busyId === item.id ? (tr ? "İşleniyor…" : "Processing…") : (tr ? "Yeniden dene" : "Retry")}</button> : <span className="matrix-note">{item.status === "PROCESSING" ? (tr ? "İşleniyor" : "In progress") : "—"}</span>}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <p className="settings-live-footnote">{tr ? "Görünüm tenant kapsamındaki son 100 açık operasyon kaydıyla sınırlıdır; notification payload verisi bu ekrana taşınmaz." : "The view is bounded to the latest 100 open tenant-scoped operational records; notification payload data is never projected here."}</p>
  </section>;
}
