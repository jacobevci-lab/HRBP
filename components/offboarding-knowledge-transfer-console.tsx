"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenCheck, CircleAlert, PlayCircle, ShieldCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { OffboardingEligibleEmployment, OffboardingProcessRow } from "@/lib/offboarding-live-data";

type Notice = { kind: "ok" | "error"; message: string } | null;
type Draft = { title: string; description: string; recipientId: string; dueAt: string };

function dateInputValue(iso: string) { return iso.slice(0, 10); }
function englishLabel(value: string) { return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" "); }

export function OffboardingKnowledgeTransferConsole({ processes, employments }: { processes: OffboardingProcessRow[]; employments: OffboardingEligibleEmployment[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const [processId, setProcessId] = useState(processes[0]?.id ?? "");
  const process = processes.find((row) => row.id === processId) ?? processes[0];
  const [draft, setDraft] = useState<Draft>({ title: "", description: "", recipientId: "", dueAt: process ? dateInputValue(process.lastWorkingDateIso) : "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const employmentMap = useMemo(() => new Map(employments.map((employment) => [employment.id, employment])), [employments]);

  useEffect(() => {
    if (processes.length && !processes.some((row) => row.id === processId)) setProcessId(processes[0].id);
  }, [processId, processes]);

  useEffect(() => {
    if (!process) return;
    setDraft((current) => ({ ...current, dueAt: dateInputValue(process.lastWorkingDateIso) }));
  }, [process?.id, process?.lastWorkingDateIso]);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const transferId = search.get("transfer");
    const linkedProcessId = search.get("process");
    const matched = transferId
      ? processes.find((row) => row.knowledgeTransfers.some((transfer) => transfer.id === transferId))
      : linkedProcessId ? processes.find((row) => row.id === linkedProcessId) : undefined;
    if (matched) setProcessId(matched.id);
    if (!transferId) return;
    const timer = window.setTimeout(() => document.getElementById(`offboarding-transfer-${transferId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    return () => window.clearTimeout(timer);
  }, [processes]);

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

  async function createTransfer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!process) return;
    const ok = await mutate(`/api/offboarding/processes/${encodeURIComponent(process.id)}/knowledge-transfers`, {
      title: draft.title,
      description: draft.description || undefined,
      recipientId: draft.recipientId,
      dueAt: draft.dueAt
    }, c("Knowledge-transfer requirement added to exit readiness.", "Bilgi devri kalemi çıkış kontrolüne eklendi."));
    if (ok) setDraft({ title: "", description: "", recipientId: "", dueAt: dateInputValue(process.lastWorkingDateIso) });
  }

  async function transition(transferId: string, status: "IN_PROGRESS" | "COMPLETED") {
    if (!process) return;
    await mutate(`/api/offboarding/processes/${encodeURIComponent(process.id)}/knowledge-transfers/${encodeURIComponent(transferId)}/status`, { status }, status === "COMPLETED" ? c("Knowledge transfer completed.", "Bilgi devri tamamlandı.") : c("Knowledge transfer started.", "Bilgi devri başlatıldı."));
  }

  if (!processes.length || !process) return null;
  const lastWorkingDate = dateInputValue(process.lastWorkingDateIso);
  return <section className="card off-ops-console">
    <div className="off-ops-head"><div><span className="section-kicker">{c("Exit handover", "Ayrılış bilgi devri")}</span><h3>{c("Knowledge-transfer readiness", "Bilgi devri hazırlığı")}</h3><p>{c("Track concrete handover items to a named recipient. Open handover items are now a hard blocker for Ready to Close and final employment termination.", "Somut devir kalemlerini isimli bir alıcıya bağlayın. Açık bilgi devri kalemleri artık Kapatmaya Hazır ve nihai istihdam sonlandırması için gerçek blokerdır.")}</p></div><span><ShieldCheck size={15}/> {c("Closure gate", "Kapanış kontrolü")}</span></div>
    <label style={{ display: "grid", gap: 6, maxWidth: 680 }}>{c("Separation process", "Ayrılış süreci")}<select value={process.id} onChange={(event) => setProcessId(event.target.value)}>{processes.map((row) => <option key={row.id} value={row.id}>{row.employeeNumber} · {row.employee} · {row.lastWorkingDate}</option>)}</select></label>
    {notice ? <div className={`off-ops-notice ${notice.kind}`}><CircleAlert size={15}/>{notice.message}</div> : null}
    <div style={{ display: "grid", gridTemplateColumns: "minmax(300px,.9fr) minmax(360px,1.2fr)", gap: 16, alignItems: "start" }}>
      <form className="off-create-form" onSubmit={createTransfer}>
        <div className="off-form-title"><BookOpenCheck size={18}/><div><strong>{c("Add handover item", "Devir kalemi ekle")}</strong><small>{c("Due date cannot exceed the governed last working date.", "Bitiş tarihi kontrollü son çalışma tarihini aşamaz.")}</small></div></div>
        <label>{c("Title", "Başlık")}<input required maxLength={180} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label>
        <label>{c("Recipient", "Alıcı")}<select required value={draft.recipientId} onChange={(event) => setDraft({ ...draft, recipientId: event.target.value })}><option value="">{c("Select authorized recipient", "Yetkili alıcı seç")}</option>{employments.map((employment) => <option key={employment.id} value={employment.id}>{employment.employeeNumber} · {employment.employee} · {employment.position}</option>)}</select></label>
        <label>{c("Due date", "Tamamlanma tarihi")}<input required type="date" max={lastWorkingDate} value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })}/></label>
        <label>{c("Handover scope / evidence", "Devir kapsamı / kanıt")}<textarea maxLength={2000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label>
        <button className="primary-button" type="submit" disabled={busy || !draft.title.trim() || !draft.recipientId || !draft.dueAt}>{c("Add to exit gate", "Çıkış kontrolüne ekle")}</button>
      </form>
      <div className="off-create-form">
        <div className="off-form-title"><BookOpenCheck size={18}/><div><strong>{c("Handover register", "Bilgi devri envanteri")}</strong><small>{c(`${process.openKnowledgeTransfers} open item(s)`, `${process.openKnowledgeTransfers} açık kalem`)}</small></div></div>
        <div className="off-task-list">{process.knowledgeTransfers.length ? process.knowledgeTransfers.map((transfer) => {
          const recipient = transfer.recipientId ? employmentMap.get(transfer.recipientId) : undefined;
          const done = transfer.rawStatus === "COMPLETED" || transfer.rawStatus === "WAIVED";
          return <div id={`offboarding-transfer-${transfer.id}`} key={transfer.id}><span className={done ? "done" : "pending"}/><div><strong>{transfer.title}</strong><small>{recipient ? `${recipient.employeeNumber} · ${recipient.employee}` : c("Recipient record", "Alıcı kaydı")} · {c("Due", "Bitiş")}: {transfer.dueAt} · {tr ? ({ NOT_STARTED:"Başlamadı", IN_PROGRESS:"Devam ediyor", COMPLETED:"Tamamlandı", WAIVED:"Muaf", BLOCKED:"Bloke" } as Record<string,string>)[transfer.rawStatus] ?? englishLabel(transfer.rawStatus) : englishLabel(transfer.rawStatus)}{transfer.description ? ` · ${transfer.description}` : ""}</small></div>{done ? <span>{c("Complete", "Tamam")}</span> : <div className="off-task-actions">{transfer.rawStatus !== "IN_PROGRESS" ? <button type="button" disabled={busy} onClick={() => void transition(transfer.id, "IN_PROGRESS")}><PlayCircle size={13}/> {c("Start", "Başlat")}</button> : null}<button type="button" disabled={busy} onClick={() => void transition(transfer.id, "COMPLETED")}>{c("Complete", "Tamamla")}</button></div>}</div>;
        }) : <div className="off-empty">{c("No explicit handover item registered yet.", "Henüz açık bilgi devri kalemi kaydedilmemiş.")}</div>}</div>
      </div>
    </div>
  </section>;
}
