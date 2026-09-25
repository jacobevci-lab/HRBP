"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, CircleAlert, CreditCard, LockKeyhole, RotateCcw, ShieldCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { OffboardingProcessRow } from "@/lib/offboarding-live-data";

type Notice = { kind: "ok" | "error"; message: string } | null;
type SettlementAction = "PREPARE" | "APPROVE" | "SETTLE" | "REVERSE";

function statusTone(status: string) {
  if (status === "SETTLED") return "done";
  if (status === "APPROVED") return "pending";
  if (status === "PREPARED") return "pending";
  return "blocked";
}

export function OffboardingFinalSettlementConsole({
  processes,
  actorId,
  canPrepare,
  canApprove,
  canSettle
}: {
  processes: OffboardingProcessRow[];
  actorId: string;
  canPrepare: boolean;
  canApprove: boolean;
  canSettle: boolean;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reversalReasons, setReversalReasons] = useState<Record<string, string>>({});
  const [focusedProcessId, setFocusedProcessId] = useState<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("process");
    setFocusedProcessId(id);
    if (!id) return;
    const timer = window.setTimeout(() => document.getElementById(`offboarding-settlement-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    return () => window.clearTimeout(timer);
  }, []);

  async function transition(processId: string, action: SettlementAction) {
    const key = `${processId}:${action}`;
    setBusy(key);
    setNotice(null);
    try {
      const note = action === "PREPARE" ? notes[processId]?.trim() : action === "REVERSE" ? reversalReasons[processId]?.trim() : undefined;
      const response = await fetch(`/api/offboarding/processes/${encodeURIComponent(processId)}/final-settlement`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...(note ? { note } : {}) })
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || c("Final settlement operation failed.", "Nihai hesap işlemi başarısız."));
      setNotice({
        kind: "ok",
        message: action === "PREPARE"
          ? c("Final settlement prepared and routed for independent approval.", "Nihai hesap hazırlandı ve bağımsız onaya yönlendirildi.")
          : action === "APPROVE"
            ? c("Final settlement independently approved and routed for settlement.", "Nihai hesap bağımsız olarak onaylandı ve ödeme/tamamlama adımına yönlendirildi.")
            : action === "SETTLE"
              ? c("Final settlement marked settled. Exit readiness will now be recalculated.", "Nihai hesap tamamlandı. Çıkış hazırlığı yeniden hesaplanacak.")
              : c("Settled final payment reversed under four-eyes control. Exit readiness is reopened and the settlement can be corrected, re-settled or the separation can be cancelled.", "Tamamlanmış nihai ödeme dört-göz kontrolüyle geri alındı. Çıkış hazırlığı yeniden açıldı; hesap düzeltilip yeniden tamamlanabilir veya ayrılış iptal edilebilir.")
      });
      if (action === "REVERSE") setReversalReasons((current) => ({ ...current, [processId]: "" }));
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : c("Final settlement operation failed.", "Nihai hesap işlemi başarısız.") });
    } finally {
      setBusy(null);
    }
  }

  return <section className="card off-ops-console">
    <div className="off-ops-head">
      <div>
        <span className="section-kicker">{c("Payroll-controlled exit gate", "Bordro kontrollü çıkış kapısı")}</span>
        <h3>{c("Final settlement governance", "Nihai hesap yönetişimi")}</h3>
        <p>{c(
          "This workflow governs settlement evidence, separation of duties and controlled reversals. It does not invent statutory payroll calculations: preparation, independent approval, settlement confirmation and any reversal remain explicit human payroll actions.",
          "Bu akış hesap kanıtını, görevler ayrılığını ve kontrollü geri alma işlemlerini yönetir. Yasal bordro hesabı uydurmaz: hazırlama, bağımsız onay, ödeme/tamamlama teyidi ve geri alma açık insan bordro aksiyonlarıdır."
        )}</p>
      </div>
      <span><ShieldCheck size={15}/> {c("Payroll authority", "Bordro yetkisi")}</span>
    </div>
    {notice ? <div className={`off-ops-notice ${notice.kind}`}><CircleAlert size={15}/>{notice.message}</div> : null}
    <div className="off-process-stack">
      {processes.length ? processes.map((process) => {
        const status = process.finalSettlementStatus || "NOT_STARTED";
        const preparedByMe = Boolean(process.finalSettlementPreparedById && process.finalSettlementPreparedById === actorId);
        const approvedByMe = Boolean(process.finalSettlementApprovedById && process.finalSettlementApprovedById === actorId);
        const settledByMe = Boolean(process.finalSettlementSettledById && process.finalSettlementSettledById === actorId);
        const focused = focusedProcessId === process.id;
        const reversalReason = reversalReasons[process.id] ?? "";
        return <article id={`offboarding-settlement-${process.id}`} className="off-process-card" style={focused ? { outline: "2px solid var(--accent)", outlineOffset: 2 } : undefined} key={process.id}>
          <header>
            <div><strong>{process.employee}</strong><small>{process.employeeNumber} · {process.position} · {c("Last day", "Son gün")} {process.lastWorkingDate}</small></div>
            <em className={`off-pill ${status.toLowerCase().replaceAll("_", "-")}`}>{status.replaceAll("_", " ")}</em>
          </header>
          <div className="off-process-meta">
            <span>{c("Exit stage", "Çıkış aşaması")} <b>{process.status}</b></span>
            <span>{c("Operational controls", "Operasyon kontrolleri")} <b>{process.controlsClear ? c("Clear", "Temiz") : c("Open", "Açık")}</b></span>
            <span>{c("Final settlement", "Nihai hesap")} <b>{status.replaceAll("_", " ")}</b></span>
          </div>
          {process.finalSettlementNote ? <div className="off-ops-notice ok"><CreditCard size={15}/><span>{c("Preparation evidence", "Hazırlama kanıtı")}: {process.finalSettlementNote}</span></div> : null}
          {process.finalSettlementReversedAt ? <div className="off-ops-notice error"><RotateCcw size={15}/><span><strong>{c("Previous settlement reversal", "Önceki nihai hesap geri alımı")}</strong>: {process.finalSettlementReversalReason ?? "—"}<br/><small>{c("Reversed by", "Geri alan")}: {process.finalSettlementReversedById ?? "—"} · {new Date(process.finalSettlementReversedAt).toLocaleString(tr ? "tr-TR" : "en-GB")}</small></span></div> : null}
          <div className="off-task-list">
            <div><span className={statusTone(status)}/><div><strong>{c("1. Prepare", "1. Hazırla")}</strong><small>{process.finalSettlementPreparedAt ? c("Prepared with recorded evidence.", "Kanıt kaydıyla hazırlandı.") : c("Payroll preparation authority records the settlement evidence/reference.", "Bordro hazırlama yetkisi nihai hesap kanıtını/referansını kaydeder.")}</small></div>{status === "NOT_STARTED" && canPrepare ? <div className="off-task-actions"><button type="button" disabled={Boolean(busy) || !(notes[process.id]?.trim()?.length >= 5)} onClick={() => void transition(process.id, "PREPARE")}>{c("Prepare", "Hazırla")}</button></div> : status !== "NOT_STARTED" ? <BadgeCheck size={16}/> : <LockKeyhole size={16}/>}</div>
            {status === "NOT_STARTED" && canPrepare ? <div style={{ display: "grid", gap: 7, padding: "8px 0" }}><textarea maxLength={2000} value={notes[process.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [process.id]: event.target.value }))} placeholder={c("Settlement evidence, payroll run/reference, final-pay review note…", "Hesap kanıtı, bordro run/referansı, nihai bordro kontrol notu…")}/></div> : null}
            <div><span className={status === "APPROVED" || status === "SETTLED" ? "done" : "pending"}/><div><strong>{c("2. Independent approval", "2. Bağımsız onay")}</strong><small>{preparedByMe && status === "PREPARED" ? c("The preparer cannot approve this settlement.", "Hazırlayan kişi bu nihai hesabı onaylayamaz.") : c("A different payroll approver confirms the prepared settlement.", "Farklı bir bordro onaylayıcısı hazırlanan nihai hesabı doğrular.")}</small></div>{status === "PREPARED" && canApprove && !preparedByMe ? <div className="off-task-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void transition(process.id, "APPROVE")}>{c("Approve", "Onayla")}</button></div> : status === "APPROVED" || status === "SETTLED" ? <BadgeCheck size={16}/> : <LockKeyhole size={16}/>}</div>
            <div><span className={status === "SETTLED" ? "done" : "pending"}/><div><strong>{c("3. Settlement confirmation", "3. Ödeme/tamamlama teyidi")}</strong><small>{approvedByMe && status === "APPROVED" ? c("The approver cannot complete the same settlement.", "Onaylayan kişi aynı nihai hesabı tamamlayamaz.") : c("A separate payroll payment authority confirms settlement completion.", "Ayrı bir bordro ödeme yetkilisi nihai hesabın tamamlandığını teyit eder.")}</small></div>{status === "APPROVED" && canSettle && !approvedByMe ? <div className="off-task-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void transition(process.id, "SETTLE")}>{c("Mark settled", "Tamamlandı işaretle")}</button></div> : status === "SETTLED" ? <BadgeCheck size={16}/> : <LockKeyhole size={16}/>}</div>
          </div>
          {status === "SETTLED" ? <div style={{ display: "grid", gap: 8, padding: "12px 14px", borderTop: "1px solid var(--border)" }}>
            <div className="off-form-title"><RotateCcw size={17}/><div><strong>{c("Controlled settlement reversal", "Kontrollü nihai hesap geri alımı")}</strong><small>{settledByMe ? c("The person who marked this settlement as settled cannot reverse the same settlement.", "Bu nihai hesabı tamamlandı işaretleyen kişi aynı hesabı geri alamaz.") : c("Use only after a confirmed payroll reversal/correction. The exit readiness gate will reopen.", "Yalnızca doğrulanmış bordro ters kaydı/düzeltmesi sonrasında kullanın. Çıkış hazırlık kapısı yeniden açılır.")}</small></div></div>
            {canSettle && !settledByMe ? <><textarea minLength={10} maxLength={2000} value={reversalReason} onChange={(event) => setReversalReasons((current) => ({ ...current, [process.id]: event.target.value }))} placeholder={c("Document reversal reference and reason (minimum 10 characters).", "Ters kayıt referansı ve gerekçesini yazın (en az 10 karakter).")}/><div className="off-task-actions"><button type="button" disabled={Boolean(busy) || reversalReason.trim().length < 10} onClick={() => void transition(process.id, "REVERSE")}><RotateCcw size={14}/> {c("Reverse settlement", "Nihai hesabı geri al")}</button></div></> : <div className="off-not-ready"><LockKeyhole size={14}/> {settledByMe ? c("Independent payroll payment authority required", "Bağımsız bordro ödeme yetkilisi gerekli") : c("Payroll payment authority required", "Bordro ödeme yetkisi gerekli")}</div>}
          </div> : null}
        </article>;
      }) : <div className="off-empty">{c("No open separation requires final settlement.", "Nihai hesap gerektiren açık ayrılış yok.")}</div>}
    </div>
  </section>;
}
