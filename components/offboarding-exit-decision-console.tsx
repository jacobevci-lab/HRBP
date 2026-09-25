"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, MessageSquareText, ShieldCheck, UserCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { OffboardingExitDecisionRow } from "@/lib/offboarding-exit-decision-data";

type Notice = { kind: "ok" | "error"; message: string } | null;

function localDateTimeInput(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function OffboardingExitDecisionConsole({ rows }: { rows: OffboardingExitDecisionRow[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const [processId, setProcessId] = useState(rows[0]?.processId ?? "");
  const row = rows.find((item) => item.processId === processId) ?? rows[0];
  const [interviewReasons, setInterviewReasons] = useState("");
  const [interviewComments, setInterviewComments] = useState("");
  const [wouldRecommend, setWouldRecommend] = useState("");
  const [conductedAt, setConductedAt] = useState(localDateTimeInput());
  const [eligible, setEligible] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (rows.length && !rows.some((item) => item.processId === processId)) setProcessId(rows[0].processId);
  }, [processId, rows]);

  useEffect(() => {
    if (!row) return;
    setEligible(row.rehireEligible === null ? "" : row.rehireEligible ? "yes" : "no");
    setDecisionReason(row.rehireDecisionReason ?? "");
  }, [row?.processId, row?.rehireEligible, row?.rehireDecisionReason]);

  async function mutate(url: string, body: Record<string, unknown>, success: string) {
    setBusy(true); setNotice(null);
    try {
      const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || c("Operation failed.", "İşlem başarısız."));
      setNotice({ kind: "ok", message: success });
      router.refresh();
      return true;
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : c("Operation failed.", "İşlem başarısız.") });
      return false;
    } finally { setBusy(false); }
  }

  async function saveInterview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!row) return;
    const reasons = interviewReasons.split("\n").map((value) => value.trim()).filter(Boolean);
    const recommendValue = wouldRecommend === "yes" ? true : wouldRecommend === "no" ? false : undefined;
    const ok = await mutate(`/api/offboarding/processes/${encodeURIComponent(row.processId)}/exit-interview`, {
      reasons,
      comments: interviewComments || undefined,
      conductedAt,
      wouldRecommend: recommendValue
    }, c("Exit interview recorded as confidential evidence.", "Çıkış görüşmesi gizli kanıt olarak kaydedildi."));
    if (ok) { setInterviewReasons(""); setInterviewComments(""); setWouldRecommend(""); setConductedAt(localDateTimeInput()); }
  }

  async function saveDecision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!row || !eligible) return;
    await mutate(`/api/offboarding/processes/${encodeURIComponent(row.processId)}/rehire-decision`, {
      eligible: eligible === "yes",
      reason: decisionReason
    }, c("Human rehire eligibility decision saved with audit evidence.", "İnsan rehire uygunluk kararı audit kanıtıyla kaydedildi."));
  }

  if (!rows.length || !row) return null;
  return <section className="card off-ops-console">
    <div className="off-ops-head"><div><span className="section-kicker">{c("Exit evidence & future eligibility", "Çıkış kanıtı ve gelecek uygunluğu")}</span><h3>{c("Exit interview + human rehire decision", "Çıkış görüşmesi + insan rehire kararı")}</h3><p>{c("Interview feedback and rehire eligibility are deliberately separate. A recommendation captured in the interview never changes eligibility automatically.", "Çıkış görüşmesi geri bildirimi ile yeniden işe alım uygunluğu özellikle ayrı tutulur. Görüşmedeki öneri hiçbir zaman uygunluk kararını otomatik değiştirmez.")}</p></div><span><ShieldCheck size={15}/> {c("Human-owned", "İnsan sahipliğinde")}</span></div>
    <label style={{ display: "grid", gap: 6, maxWidth: 680 }}>{c("Separation process", "Ayrılış süreci")}<select value={row.processId} onChange={(event) => { setProcessId(event.target.value); setNotice(null); }}>{rows.map((item) => <option key={item.processId} value={item.processId}>{item.employeeNumber} · {item.employee} · {new Date(item.lastWorkingDateIso).toLocaleDateString(tr ? "tr-TR" : "en-GB")}</option>)}</select></label>
    {notice ? <div className={`off-ops-notice ${notice.kind}`}><CircleAlert size={15}/>{notice.message}</div> : null}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 16, alignItems: "start" }}>
      <div className="off-create-form">
        <div className="off-form-title"><MessageSquareText size={18}/><div><strong>{c("Confidential exit interview", "Gizli çıkış görüşmesi")}</strong><small>{c("One governed interview record per separation.", "Her ayrılış için tek yönetişimli görüşme kaydı.")}</small></div></div>
        {row.exitInterview ? <div className="off-task-list"><div><span className="done"/><div><strong>{c("Interview recorded", "Görüşme kaydedildi")}</strong><small>{new Date(row.exitInterview.conductedAt).toLocaleString(tr ? "tr-TR" : "en-GB")} · {row.exitInterview.reasons.join(" · ") || c("No reason labels", "Neden etiketi yok")}{row.exitInterview.comments ? ` · ${row.exitInterview.comments}` : ""}</small></div><span>{row.exitInterview.wouldRecommend === null ? c("No recommendation", "Öneri yok") : row.exitInterview.wouldRecommend ? c("Would recommend", "Önerir") : c("Would not recommend", "Önermez")}</span></div></div> : <form onSubmit={saveInterview} style={{ display: "grid", gap: 9 }}>
          <label>{c("Interview time", "Görüşme zamanı")}<input required type="datetime-local" max={localDateTimeInput(new Date(Date.now() + 5 * 60_000))} value={conductedAt} onChange={(event) => setConductedAt(event.target.value)}/></label>
          <label>{c("Reasons / themes (one per line, max 10)", "Nedenler / temalar (satır başına bir, en fazla 10)")}<textarea value={interviewReasons} onChange={(event) => setInterviewReasons(event.target.value)} placeholder={c("Career growth\nManager relationship", "Kariyer gelişimi\nYönetici ilişkisi")}/></label>
          <label>{c("Comments", "Notlar")}<textarea maxLength={4000} value={interviewComments} onChange={(event) => setInterviewComments(event.target.value)}/></label>
          <label>{c("Would the interviewer recommend future employment?", "Görüşmeci gelecekte tekrar çalışmayı önerir mi?")}<select value={wouldRecommend} onChange={(event) => setWouldRecommend(event.target.value)}><option value="">{c("No interview recommendation", "Görüşme önerisi yok")}</option><option value="yes">{c("Yes", "Evet")}</option><option value="no">{c("No", "Hayır")}</option></select></label>
          <button className="secondary-button" type="submit" disabled={busy || (!interviewReasons.trim() && !interviewComments.trim())}>{c("Record interview", "Görüşmeyi kaydet")}</button>
        </form>}
      </div>
      <form className="off-create-form" onSubmit={saveDecision}>
        <div className="off-form-title"><UserCheck size={18}/><div><strong>{c("Rehire eligibility", "Yeniden işe alım uygunluğu")}</strong><small>{c("Explicit HR decision only; no score, model or interview auto-conversion.", "Yalnızca açık İK kararı; skor, model veya görüşmeden otomatik dönüşüm yok.")}</small></div></div>
        <label>{c("Human decision", "İnsan kararı")}<select required value={eligible} onChange={(event) => setEligible(event.target.value)}><option value="">{c("Select decision", "Karar seç")}</option><option value="yes">{c("Eligible for rehire", "Yeniden işe alıma uygun")}</option><option value="no">{c("Not eligible for rehire", "Yeniden işe alıma uygun değil")}</option></select></label>
        <label>{c("Decision rationale", "Karar gerekçesi")}<textarea required minLength={10} maxLength={2000} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} placeholder={c("Document the human rationale and supporting policy/evidence.", "İnsan kararının gerekçesini ve destekleyen politika/kanıtı belgeleyin.")}/></label>
        {row.rehireDecisionAt ? <small>{c("Last human decision", "Son insan kararı")}: {new Date(row.rehireDecisionAt).toLocaleString(tr ? "tr-TR" : "en-GB")} · {row.rehireDecisionById}</small> : null}
        <button className="primary-button" type="submit" disabled={busy || !eligible || decisionReason.trim().length < 10}>{row.rehireEligible === null ? c("Record decision", "Kararı kaydet") : c("Revise decision with audit", "Kararı audit ile güncelle")}</button>
      </form>
    </div>
  </section>;
}
