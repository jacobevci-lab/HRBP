"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BadgeCheck, BriefcaseBusiness, CircleAlert, UserRoundPlus, XCircle } from "lucide-react";
import type { OffboardingProcessRow } from "@/lib/offboarding-live-data";
import { useLocale } from "@/components/locale-provider";

type Editor = {
  processId: string;
  required: boolean;
  reason: string;
  targetHireDate: string;
} | null;

type Notice = { kind: "ok" | "error"; message: string } | null;

export function OffboardingReplacementConsole({
  processes,
  canRecruitingWrite
}: {
  processes: OffboardingProcessRow[];
  canRecruitingWrite: boolean;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const [editor, setEditor] = useState<Editor>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  function start(process: OffboardingProcessRow, required: boolean) {
    setNotice(null);
    setEditor({
      processId: process.id,
      required,
      reason: "",
      targetHireDate: required ? process.lastWorkingDateIso.slice(0, 10) : ""
    });
  }

  async function submit() {
    if (!editor) return;
    const reason = editor.reason.trim();
    if (reason.length < 10) {
      setNotice({ kind: "error", message: c("Enter a decision reason of at least 10 characters.", "En az 10 karakterlik karar gerekçesi girin.") });
      return;
    }
    const url = `/api/offboarding/processes/${encodeURIComponent(editor.processId)}/replacement`;
    setBusy(url);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          required: editor.required,
          reason,
          ...(editor.required && editor.targetHireDate ? { targetHireDate: editor.targetHireDate } : {})
        })
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; data?: { replacementRequisitionId?: string | null } };
      if (!response.ok) throw new Error(payload.error || c("Replacement decision failed.", "Yedekleme kararı kaydedilemedi."));
      setNotice({
        kind: "ok",
        message: editor.required
          ? c("Backfill decision recorded and a governed draft requisition was handed to Recruiting.", "Yedek kadro kararı kaydedildi ve kontrollü taslak işe alım talebi İşe Alım'a devredildi.")
          : c("No-replacement decision recorded with evidence.", "Yedekleme yapılmama kararı kanıtıyla kaydedildi.")
      });
      setEditor(null);
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : c("Replacement decision failed.", "Yedekleme kararı kaydedilemedi.") });
    } finally {
      setBusy(null);
    }
  }

  return <section className="card off-ops-console">
    <div className="off-ops-head">
      <div>
        <span className="section-kicker">{c("Connected lifecycle handoff", "Bağlı yaşam döngüsü devri")}</span>
        <h3>{c("Replacement & backfill decision", "Yedek kadro ve işe alım kararı")}</h3>
        <p>{c("HR records whether the role will be replaced. A positive human decision creates a Draft requisition for Recruiting; it never opens hiring automatically.", "İK rolün yeniden doldurulup doldurulmayacağını kaydeder. Olumlu insan kararı İşe Alım için Taslak talep oluşturur; işe alımı otomatik olarak açmaz.")}</p>
      </div>
      <span><BriefcaseBusiness size={15}/> {c("Offboarding → Recruiting", "İşten Ayrılış → İşe Alım")}</span>
    </div>

    {notice ? <div className={`off-ops-notice ${notice.kind}`}><CircleAlert size={15}/>{notice.message}</div> : null}

    <div className="off-process-stack">
      {processes.length ? processes.map((process) => {
        const handedOff = Boolean(process.replacementRequisitionId);
        const decidedNoReplacement = process.replacementRequired === false;
        const undecided = process.replacementRequired === null;
        const canCreateBackfill = canRecruitingWrite && Boolean(process.positionId) && !handedOff;
        return <article className="off-process-card" key={process.id}>
          <header>
            <div>
              <strong>{process.employee}</strong>
              <small>{process.employeeNumber} · {process.position} · {c("Last day", "Son gün")} {process.lastWorkingDate}</small>
            </div>
            <em className={`off-pill ${handedOff ? "ready-to-close" : decidedNoReplacement ? "closed" : "notice-period"}`}>
              {handedOff ? c("Backfill drafted", "Yedek kadro taslak") : decidedNoReplacement ? c("No replacement", "Yedekleme yok") : c("Decision pending", "Karar bekliyor")}
            </em>
          </header>

          <div className="off-process-meta">
            <span>{c("Position-backed", "Pozisyona bağlı")} <b>{process.positionId ? c("Yes", "Evet") : c("No", "Hayır")}</b></span>
            <span>{c("Replacement decision", "Yedekleme kararı")} <b>{undecided ? c("Not recorded", "Kaydedilmedi") : process.replacementRequired ? c("Required", "Gerekli") : c("Not required", "Gerekli değil")}</b></span>
            <span>{c("Recruiting handoff", "İşe Alım devri")} <b>{process.replacementRequisitionId ?? "—"}</b></span>
          </div>

          {process.replacementDecisionReason ? <div className="off-ready" style={{ margin: "0 14px 12px" }}>
            <BadgeCheck size={14}/>
            <span>{process.replacementDecisionReason}<br/><small>{c("Decided by", "Kararı veren")}: {process.replacementDecisionById ?? "—"}{process.replacementDecisionAt ? ` · ${new Intl.DateTimeFormat(tr ? "tr-TR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(process.replacementDecisionAt))}` : ""}</small></span>
          </div> : null}

          {handedOff ? <footer>
            <div className="off-ready"><UserRoundPlus size={14}/> {c("Recruiting owns the draft from this point.", "Bu noktadan sonra taslağın sahibi İşe Alım'dır.")}</div>
            <div className="off-task-actions"><Link className="secondary-button" href="/module/recruiting">{c("Open Recruiting", "İşe Alım'ı aç")}</Link></div>
          </footer> : <footer>
            <div className={undecided ? "off-not-ready" : "off-ready"}>{undecided ? <CircleAlert size={14}/> : <BadgeCheck size={14}/>} {undecided ? c("A human replacement decision is still pending.", "İnsan tarafından yedekleme kararı henüz verilmedi.") : c("Decision recorded; it can still be changed before recruiting handoff.", "Karar kaydedildi; İşe Alım devrinden önce değiştirilebilir.")}</div>
            <div className="off-task-actions">
              <button type="button" disabled={Boolean(busy) || !canCreateBackfill} onClick={() => start(process, true)} title={!process.positionId ? c("A position-backed employment is required.", "Pozisyona bağlı istihdam gereklidir.") : !canRecruitingWrite ? c("recruiting:write is required to create a backfill draft.", "Yedek kadro taslağı oluşturmak için recruiting:write gerekir.") : undefined}><UserRoundPlus size={14}/> {c("Create backfill draft", "Yedek kadro taslağı oluştur")}</button>
              <button type="button" disabled={Boolean(busy)} onClick={() => start(process, false)}><XCircle size={14}/> {c("No replacement", "Yedekleme yok")}</button>
            </div>
          </footer>}

          {editor?.processId === process.id ? <div style={{ display: "grid", gap: 8, padding: "0 14px 14px" }}>
            <strong>{editor.required ? c("Approve a recruiting handoff", "İşe Alım devrini onayla") : c("Record no replacement", "Yedekleme yapılmayacağını kaydet")}</strong>
            {editor.required ? <label>{c("Target hire date", "Hedef işe alım tarihi")}<input type="date" value={editor.targetHireDate} onChange={(event) => setEditor({ ...editor, targetHireDate: event.target.value })}/></label> : null}
            <label>{c("Decision reason", "Karar gerekçesi")}<textarea autoFocus minLength={10} maxLength={2000} value={editor.reason} onChange={(event) => setEditor({ ...editor, reason: event.target.value })} placeholder={editor.required ? c("Why should this position be backfilled?", "Bu pozisyon neden yeniden doldurulmalı?") : c("Why is no replacement required?", "Neden yedekleme gerekmiyor?")}/></label>
            <div className="off-task-actions">
              <button type="button" disabled={Boolean(busy) || editor.reason.trim().length < 10} onClick={() => void submit()}>{c("Confirm decision", "Kararı onayla")}</button>
              <button type="button" disabled={Boolean(busy)} onClick={() => setEditor(null)}>{c("Cancel", "Vazgeç")}</button>
            </div>
          </div> : null}
        </article>;
      }) : <div className="off-empty">{c("No active separations require a replacement decision.", "Yedekleme kararı gerektiren aktif ayrılış bulunmuyor.")}</div>}
    </div>
  </section>;
}
