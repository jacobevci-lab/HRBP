import { Archive, Ban, CheckCircle2, FileClock, ShieldCheck } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { OffboardingHistoryData } from "@/lib/offboarding-history-data";

function c(locale: Locale, en: string, tr: string) {
  return locale === "tr" ? tr : en;
}

function fmt(locale: Locale, value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul"
  }).format(new Date(value));
}

function label(locale: Locale, value: string) {
  const normalized = value.toUpperCase();
  if (locale !== "tr") return normalized.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
  const map: Record<string, string> = {
    RESIGNATION: "İstifa",
    TERMINATION: "Fesih",
    REDUNDANCY: "Pozisyon iptali",
    RETIREMENT: "Emeklilik",
    END_OF_CONTRACT: "Sözleşme sonu",
    DEATH: "Vefat",
    OTHER: "Diğer",
    CLOSED: "Kapalı",
    CANCELLED: "İptal edildi",
    SETTLED: "Tamamlandı",
    NOT_STARTED: "Başlamadı"
  };
  return map[normalized] ?? normalized.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function compactHash(value: string) {
  return value.length <= 22 ? value : `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function replacementLabel(locale: Locale, required: boolean | null, requisitionId: string | null) {
  if (required === null) return c(locale, "Not recorded", "Kaydedilmedi");
  if (!required) return c(locale, "No replacement", "Yedekleme yok");
  return requisitionId ? `${c(locale, "Backfill", "Yedek kadro")} · ${requisitionId.slice(0, 10)}` : c(locale, "Backfill approved", "Yedek kadro onaylandı");
}

export function OffboardingHistory({ data, locale }: { data: OffboardingHistoryData; locale: Locale }) {
  return <section className="card off-panel">
    <div className="off-head">
      <div>
        <span className="section-kicker">{c(locale, "Immutable exit history", "Değiştirilemez ayrılış geçmişi")}</span>
        <h3>{c(locale, "Closed & cancelled separations", "Kapatılan ve iptal edilen ayrılışlar")}</h3>
        <p>{c(locale, "Terminal processes remain read-only so HR can reconstruct what happened, who decided it and which controls were complete at the terminal state.", "Terminal süreçler salt okunur tutulur; böylece İK ne olduğunu, kararı kimin verdiğini ve terminal durumda hangi kontrollerin tamamlandığını yeniden oluşturabilir.")}</p>
      </div>
      <span className="off-live-badge"><Archive size={14}/> {data.total}</span>
    </div>

    <div className="off-process-meta" style={{ marginBottom: 14 }}>
      <span>{c(locale, "Closed", "Kapalı")} <b>{data.closed}</b></span>
      <span>{c(locale, "Cancelled", "İptal")} <b>{data.cancelled}</b></span>
      <span>{c(locale, "Terminal in 30 days", "30 günde terminal")} <b>{data.last30Days}</b></span>
      <span>{c(locale, "Audit chain", "Audit zinciri")} <b>{data.auditVisible ? c(locale, "Visible", "Görünür") : c(locale, "Restricted", "Kısıtlı")}</b></span>
    </div>

    {data.rows.length ? <div className="off-process-stack">{data.rows.map((row) => {
      const cancelled = row.status === "CANCELLED";
      const openControls = row.tasksOpen + row.assetsOpen + row.accessOpen + row.knowledgeTransfersOpen;
      return <article className="off-process-card" key={row.id}>
        <header>
          <div>
            <strong>{row.employee}</strong>
            <small>{row.employeeNumber} · {row.position} · {label(locale, row.type)}</small>
          </div>
          <em className={`off-pill ${cancelled ? "cancelled" : "closed"}`}>{label(locale, row.status)}</em>
        </header>

        <div className="off-process-meta">
          <span>{c(locale, "Last day", "Son gün")} <b>{fmt(locale, row.lastWorkingDate)}</b></span>
          <span>{c(locale, "Terminal", "Terminal")} <b>{fmt(locale, row.terminalAt)}</b></span>
          <span>{c(locale, "Tasks", "Görevler")} <b>{row.tasksCompleted} {c(locale, "done", "tamam")} · {row.tasksWaived} {c(locale, "waived", "muaf")} · {row.tasksOpen} {c(locale, "open", "açık")}</b></span>
          <span>{c(locale, "Assets", "Varlıklar")} <b>{row.assetsReturned} {c(locale, "returned", "iade")} · {row.assetsWrittenOff} {c(locale, "written off", "düşüm")} · {row.assetsOpen} {c(locale, "open", "açık")}</b></span>
          <span>{c(locale, "Access", "Erişim")} <b>{row.accessRevoked} {c(locale, "revoked", "iptal")} · {row.accessExceptions} {c(locale, "exceptions", "istisna")} · {row.accessOpen} {c(locale, "open", "açık")}</b></span>
          <span>{c(locale, "Replacement", "Yedekleme")} <b>{replacementLabel(locale, row.replacementRequired, row.replacementRequisitionId)}</b></span>
          <span>{c(locale, "Final settlement", "Nihai hesap")} <b>{label(locale, row.finalSettlementStatus)}</b></span>
        </div>

        <div className={cancelled ? "off-not-ready" : "off-ready"} style={{ margin: "0 14px 12px" }}>
          {cancelled ? <Ban size={14}/> : <CheckCircle2 size={14}/>} {cancelled
            ? c(locale, `Cancelled without employment termination${openControls ? ` · ${openControls} control(s) intentionally left open` : ""}`, `İstihdam sonlandırılmadan iptal edildi${openControls ? ` · ${openControls} kontrol bilinçli olarak açık kaldı` : ""}`)
            : c(locale, "Employment termination completed after the governed exit gate.", "Yönetişimli çıkış kontrolünden sonra istihdam sonlandırması tamamlandı.")}
        </div>

        {cancelled && row.cancellationReason ? <div className="off-ops-notice error" style={{ margin: "0 14px 12px" }}><Ban size={15}/><span><strong>{c(locale, "Cancellation reason", "İptal gerekçesi")}: </strong>{row.cancellationReason}<br/><small>{c(locale, "Cancelled by", "İptal eden")}: {row.cancelledById ?? "—"} · {fmt(locale, row.cancelledAt)}</small></span></div> : null}

        <details style={{ margin: "0 14px 12px" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}><FileClock size={15}/> {c(locale, "Evidence timeline", "Kanıt zaman çizgisi")} · {row.events.length}</summary>
          <div className="off-task-list" style={{ marginTop: 9 }}>
            {row.events.map((event) => <div key={event.key}><span className="done"/><div><strong>{event.title}</strong><small>{fmt(locale, event.occurredAt)} · {c(locale, "Actor", "İşlemi yapan")}: {event.actorId ?? "—"}{event.detail ? ` · ${event.detail}` : ""}</small></div></div>)}
          </div>
        </details>

        <details style={{ margin: "0 14px 14px" }}>
          <summary style={{ cursor: data.auditVisible ? "pointer" : "default", fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}><ShieldCheck size={15}/> {c(locale, "Immutable audit evidence", "Değiştirilemez audit kanıtı")} · {data.auditVisible ? row.auditEvidence.length : c(locale, "audit:read required", "audit:read gerekli")}</summary>
          {data.auditVisible ? <div className="off-task-list" style={{ marginTop: 9 }}>{row.auditEvidence.length ? row.auditEvidence.map((event, index) => <div key={`${event.hash}:${index}`}><span className="done"/><div><strong>{event.action}</strong><small>{fmt(locale, event.occurredAt)} · {event.resourceType} · {c(locale, "Actor", "İşlemi yapan")}: {event.actorId}{event.purpose ? ` · ${event.purpose}` : ""}<br/>{c(locale, "Hash", "Hash")}: <code>{compactHash(event.hash)}</code>{event.previousHash ? ` · ${c(locale, "Previous", "Önceki")}: ${compactHash(event.previousHash)}` : ""}</small></div></div>) : <div><span className="pending"/><div><strong>{c(locale, "No process-level audit rows", "Süreç seviyesinde audit kaydı yok")}</strong><small>{c(locale, "Domain evidence above is still preserved.", "Yukarıdaki domain kanıtı yine de korunur.")}</small></div></div>}</div> : null}
        </details>
      </article>;
    })}</div> : <div className="off-empty">{c(locale, "No closed or cancelled separations exist in your authorized employment scope yet.", "Yetkili istihdam kapsamınızda henüz kapatılmış veya iptal edilmiş ayrılış bulunmuyor.")}</div>}
  </section>;
}
