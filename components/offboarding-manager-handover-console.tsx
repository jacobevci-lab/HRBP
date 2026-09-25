"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRightLeft, CircleAlert, Network, UsersRound } from "lucide-react";
import type { OffboardingManagerCandidate, OffboardingProcessRow } from "@/lib/offboarding-live-data";
import { useLocale } from "@/components/locale-provider";

type Editor = { processId: string; newManagerEmploymentId: string; reason: string } | null;
type Notice = { kind: "ok" | "error"; message: string } | null;

export function OffboardingManagerHandoverConsole({ processes, managerCandidates }: { processes: OffboardingProcessRow[]; managerCandidates: OffboardingManagerCandidate[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const [editor, setEditor] = useState<Editor>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const affected = useMemo(() => processes.filter((process) => process.directReportsOpen > 0), [processes]);

  async function submit(process: OffboardingProcessRow) {
    if (!editor || editor.processId !== process.id) return;
    const reason = editor.reason.trim();
    if (!editor.newManagerEmploymentId) {
      setNotice({ kind: "error", message: c("Select a new manager.", "Yeni yöneticiyi seçin.") });
      return;
    }
    if (reason.length < 10) {
      setNotice({ kind: "error", message: c("Enter a handover reason of at least 10 characters.", "En az 10 karakterlik devir gerekçesi girin.") });
      return;
    }
    const url = `/api/offboarding/processes/${encodeURIComponent(process.id)}/manager-handover`;
    setBusy(url);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newManagerEmploymentId: editor.newManagerEmploymentId, reason })
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; data?: { reassignedReports?: number; newManager?: string } };
      if (!response.ok) throw new Error(payload.error || c("Manager handover failed.", "Yönetici devri başarısız oldu."));
      setNotice({ kind: "ok", message: c(`${payload.data?.reassignedReports ?? process.directReportsOpen} direct report(s) moved to ${payload.data?.newManager ?? "the selected manager"}.`, `${payload.data?.reassignedReports ?? process.directReportsOpen} bağlı çalışan ${payload.data?.newManager ?? "seçilen yöneticiye"} devredildi.`) });
      setEditor(null);
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : c("Manager handover failed.", "Yönetici devri başarısız oldu.") });
    } finally {
      setBusy(null);
    }
  }

  if (!affected.length) return null;

  return <section className="card off-ops-console">
    <div className="off-ops-head">
      <div>
        <span className="section-kicker">{c("Organization continuity", "Organizasyon sürekliliği")}</span>
        <h3>{c("Manager reporting-line handover", "Yönetici raporlama hattı devri")}</h3>
        <p>{c("A manager cannot leave active direct reports attached to a terminated employment. Reassignment is a governed human action and is part of the exit readiness gate.", "Bir yönetici, aktif bağlı çalışanları sonlandırılmış istihdama bağlı bırakarak ayrılamaz. Yeniden atama kontrollü bir insan kararıdır ve çıkış hazırlık kapısının parçasıdır.")}</p>
      </div>
      <span><Network size={15}/> {affected.reduce((sum, process) => sum + process.directReportsOpen, 0)}</span>
    </div>

    {notice ? <div className={`off-ops-notice ${notice.kind}`}><CircleAlert size={15}/>{notice.message}</div> : null}

    <div className="off-process-stack">
      {affected.map((process) => {
        const reportIds = new Set(process.directReports.map((report) => report.id));
        const options = managerCandidates.filter((candidate) => candidate.id !== process.employmentId && !reportIds.has(candidate.id));
        return <article className="off-process-card" key={process.id}>
          <header>
            <div><strong>{process.employee}</strong><small>{process.employeeNumber} · {process.position} · {c("Last day", "Son gün")} {process.lastWorkingDate}</small></div>
            <em className="off-pill clearance">{process.directReportsOpen} {c("direct reports", "bağlı çalışan")}</em>
          </header>

          <div className="off-task-list" style={{ margin: "0 14px 12px" }}>
            {process.directReports.map((report) => <div key={report.id}><span className="pending"/><div><strong>{report.employee}</strong><small>{report.employeeNumber} · {report.position} · {report.status}</small></div></div>)}
          </div>

          <footer>
            <div className="off-not-ready"><UsersRound size={14}/> {c("Closure remains blocked until these reporting lines are reassigned.", "Bu raporlama hatları devredilene kadar kapanış bloke kalır.")}</div>
            <div className="off-task-actions"><button type="button" disabled={Boolean(busy) || !options.length} onClick={() => { setNotice(null); setEditor({ processId: process.id, newManagerEmploymentId: "", reason: "" }); }}><ArrowRightLeft size={14}/> {c("Reassign reports", "Bağlı çalışanları devret")}</button></div>
          </footer>

          {editor?.processId === process.id ? <div style={{ display: "grid", gap: 8, padding: "0 14px 14px" }}>
            <label>{c("New manager", "Yeni yönetici")}<select value={editor.newManagerEmploymentId} onChange={(event) => setEditor({ ...editor, newManagerEmploymentId: event.target.value })}><option value="">{c("Select manager", "Yönetici seç")}</option>{options.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.employee} · {candidate.position} · {candidate.department}</option>)}</select></label>
            <label>{c("Handover reason", "Devir gerekçesi")}<textarea minLength={10} maxLength={2000} value={editor.reason} onChange={(event) => setEditor({ ...editor, reason: event.target.value })} placeholder={c("Document the organization/continuity reason for this reporting-line change.", "Bu raporlama hattı değişikliğinin organizasyon/süreklilik gerekçesini yazın.")}/></label>
            <small>{c("The server rejects any selection inside the departing manager's reporting subtree to prevent reporting cycles.", "Sunucu, raporlama döngüsünü önlemek için ayrılan yöneticinin alt raporlama ağındaki seçimleri reddeder.")}</small>
            <div className="off-task-actions"><button type="button" disabled={Boolean(busy) || !editor.newManagerEmploymentId || editor.reason.trim().length < 10} onClick={() => void submit(process)}>{c("Confirm handover", "Devri onayla")}</button><button type="button" disabled={Boolean(busy)} onClick={() => setEditor(null)}>{c("Cancel", "Vazgeç")}</button></div>
          </div> : null}
        </article>;
      })}
    </div>
  </section>;
}
