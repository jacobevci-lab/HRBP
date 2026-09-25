"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CircleAlert, LockKeyhole, ShieldCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { OffboardingProcessRow } from "@/lib/offboarding-live-data";

type Editor = { processId: string; noticeDate: string; lastWorkingDate: string; reason: string } | null;
type Notice = { kind: "ok" | "error"; message: string } | null;

function inputDate(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

export function OffboardingScheduleAmendmentConsole({ processes }: { processes: OffboardingProcessRow[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const [editor, setEditor] = useState<Editor>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  function open(process: OffboardingProcessRow) {
    setNotice(null);
    setEditor({
      processId: process.id,
      noticeDate: inputDate(process.noticeDateIso) || inputDate(process.lastWorkingDateIso),
      lastWorkingDate: inputDate(process.lastWorkingDateIso),
      reason: ""
    });
  }

  async function submit(process: OffboardingProcessRow) {
    if (!editor || editor.processId !== process.id) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/offboarding/processes/${encodeURIComponent(process.id)}/schedule`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noticeDate: editor.noticeDate, lastWorkingDate: editor.lastWorkingDate, reason: editor.reason.trim() })
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; data?: { synchronized?: { tasks?: number; knowledgeTransfers?: number; accessSchedules?: number } } };
      if (!response.ok) throw new Error(payload.error || c("Schedule amendment failed.", "Takvim değişikliği başarısız."));
      const sync = payload.data?.synchronized;
      setNotice({
        kind: "ok",
        message: c(
          `Exit schedule updated. ${sync?.tasks ?? 0} task deadline(s), ${sync?.knowledgeTransfers ?? 0} handover deadline(s) and ${sync?.accessSchedules ?? 0} access schedule(s) were synchronized.`,
          `Çıkış takvimi güncellendi. ${sync?.tasks ?? 0} görev tarihi, ${sync?.knowledgeTransfers ?? 0} bilgi devri tarihi ve ${sync?.accessSchedules ?? 0} erişim takvimi senkronize edildi.`
        )
      });
      setEditor(null);
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : c("Schedule amendment failed.", "Takvim değişikliği başarısız.") });
    } finally {
      setBusy(false);
    }
  }

  return <section className="card off-ops-console">
    <div className="off-ops-head">
      <div>
        <span className="section-kicker">{c("Governed date changes", "Yönetişimli tarih değişiklikleri")}</span>
        <h3>{c("Exit schedule amendments", "Çıkış takvimi değişiklikleri")}</h3>
        <p>{c(
          "Change notice and last-working dates without silently breaking downstream exit controls. Aligned task and handover deadlines move with the exit date, scheduled access revocations preserve their relative timing, and settled final pay must be reversed first.",
          "Bildirim ve son çalışma tarihlerini bağlı çıkış kontrollerini sessizce bozmadan değiştirin. Hizalı görev ve bilgi devri tarihleri çıkış tarihiyle birlikte taşınır, planlı erişim iptalleri göreli zamanlamasını korur ve tamamlanmış nihai ödeme önce geri alınmalıdır."
        )}</p>
      </div>
      <span><ShieldCheck size={15}/> {c("Restricted change", "Kısıtlı değişiklik")}</span>
    </div>

    {notice ? <div className={`off-ops-notice ${notice.kind}`}><CircleAlert size={15}/>{notice.message}</div> : null}
    <div className="off-process-stack">
      {processes.length ? processes.map((process) => {
        const editing = editor?.processId === process.id;
        const settlementLocked = process.finalSettlementClear;
        return <article className="off-process-card" key={process.id}>
          <header>
            <div><strong>{process.employee}</strong><small>{process.employeeNumber} · {process.position}</small></div>
            <em className={`off-pill ${process.rawStatus.toLowerCase().replaceAll("_", "-")}`}>{process.status}</em>
          </header>
          <div className="off-process-meta">
            <span>{c("Notice", "Bildirim")} <b>{process.noticeDate}</b></span>
            <span>{c("Last day", "Son gün")} <b>{process.lastWorkingDate}</b></span>
            <span>{c("Final settlement", "Nihai hesap")} <b>{process.finalSettlementStatus.replaceAll("_", " ")}</b></span>
          </div>
          {settlementLocked ? <div className="off-not-ready" style={{ margin: "0 14px 12px" }}><LockKeyhole size={14}/> {c("Reverse the settled final payment before changing the exit schedule.", "Çıkış takvimini değiştirmeden önce tamamlanmış nihai ödemeyi geri alın.")}</div> : null}
          {!editing ? <div className="off-task-actions" style={{ padding: "0 14px 14px" }}><button type="button" disabled={busy || settlementLocked} onClick={() => open(process)}><CalendarClock size={14}/> {c("Amend dates", "Tarihleri değiştir")}</button></div> : <div style={{ display: "grid", gap: 10, padding: "0 14px 14px" }}>
            <div className="off-form-row">
              <label>{c("Notice date", "Bildirim tarihi")}<input type="date" value={editor.noticeDate} onChange={(event) => setEditor({ ...editor, noticeDate: event.target.value })}/></label>
              <label>{c("Last working date", "Son çalışma tarihi")}<input type="date" value={editor.lastWorkingDate} onChange={(event) => setEditor({ ...editor, lastWorkingDate: event.target.value })}/></label>
            </div>
            <label>{c("Change reason", "Değişiklik gerekçesi")}<textarea minLength={10} maxLength={2000} value={editor.reason} onChange={(event) => setEditor({ ...editor, reason: event.target.value })} placeholder={c("Document the approved reason or reference (minimum 10 characters).", "Onaylı gerekçeyi veya referansı yazın (en az 10 karakter).")}/></label>
            <div className="off-task-actions">
              <button type="button" disabled={busy || !editor.noticeDate || !editor.lastWorkingDate || editor.reason.trim().length < 10} onClick={() => void submit(process)}>{busy ? c("Saving…", "Kaydediliyor…") : c("Apply governed change", "Kontrollü değişikliği uygula")}</button>
              <button type="button" disabled={busy} onClick={() => setEditor(null)}>{c("Cancel", "Vazgeç")}</button>
            </div>
          </div>}
        </article>;
      }) : <div className="off-empty">{c("No active separation schedule is available to amend.", "Değiştirilebilecek aktif ayrılış takvimi yok.")}</div>}
    </div>
  </section>;
}
