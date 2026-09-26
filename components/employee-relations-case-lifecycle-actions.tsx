"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CaseActionStatus, CaseStatus } from "@prisma/client";
import type { Locale } from "@/lib/i18n";

const caseTransitions: Record<CaseStatus, CaseStatus[]> = {
  DRAFT: ["OPEN"],
  OPEN: ["INVESTIGATING"],
  INVESTIGATING: ["ACTION_REQUIRED", "RESOLVED"],
  ACTION_REQUIRED: ["INVESTIGATING", "RESOLVED"],
  RESOLVED: ["INVESTIGATING", "CLOSED"],
  CLOSED: []
};
const reasonCaseStatuses = new Set<CaseStatus>(["ACTION_REQUIRED", "RESOLVED", "CLOSED"]);
const actionTransitions: Record<CaseActionStatus, CaseActionStatus[]> = {
  OPEN: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: []
};

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }
function label(locale: Locale, value: string) {
  const normalized = value.toUpperCase();
  if (locale !== "tr") return normalized.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
  const map: Record<string, string> = {
    DRAFT: "Taslak", OPEN: "Açık", INVESTIGATING: "Soruşturuluyor", ACTION_REQUIRED: "Aksiyon gerekli", RESOLVED: "Çözüldü", CLOSED: "Kapalı",
    IN_PROGRESS: "Devam ediyor", COMPLETED: "Tamamlandı", CANCELLED: "İptal edildi"
  };
  return map[normalized] ?? normalized;
}

async function acknowledgeNotifications(resourceType: "EmployeeCase" | "CaseAction", resourceId: string) {
  try {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceType, resourceId, read: true })
    });
    if (response.ok) window.dispatchEvent(new Event("hrbp:notifications-changed"));
  } catch {
    // Notification acknowledgement is deliberately best-effort. A governed
    // case mutation must not be rolled back because badge cleanup failed.
  }
}

type ActionItem = { id: string; actionType: string; status: CaseActionStatus; ownerId: string; dueAt: string | null };

export function EmployeeRelationsCaseLifecycleActions({ caseId, status, actions, locale, focusedActionId }: { caseId: string; status: CaseStatus; actions: ActionItem[]; locale: Locale; focusedActionId?: string | null }) {
  const router = useRouter();
  const options = caseTransitions[status] ?? [];
  const [target, setTarget] = useState<CaseStatus | "">(options[0] ?? "");
  const [reason, setReason] = useState("");
  const [actionReasons, setActionReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function changeCase() {
    if (!target) return;
    const needsReason = reasonCaseStatuses.has(target) || (status === "RESOLVED" && target === "INVESTIGATING");
    if (needsReason && reason.trim().length < 10) { setMessage(c(locale, "A reason of at least 10 characters is required.", "En az 10 karakterlik gerekçe gereklidir.")); return; }
    setBusy("case"); setMessage(null);
    try {
      const response = await fetch(`/api/employee-relations/cases/${encodeURIComponent(caseId)}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: target, ...(reason.trim() ? { reason: reason.trim() } : {}) }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Case transition failed.");
      setReason(""); setMessage(c(locale, "Case lifecycle updated.", "Vaka yaşam döngüsü güncellendi."));
      await acknowledgeNotifications("EmployeeCase", caseId);
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : c(locale, "Case transition failed.", "Vaka geçişi başarısız.")); }
    finally { setBusy(null); }
  }

  async function changeAction(action: ActionItem, targetStatus: CaseActionStatus) {
    const actionReason = actionReasons[action.id]?.trim() ?? "";
    if ((targetStatus === "COMPLETED" || targetStatus === "CANCELLED") && actionReason.length < 10) { setMessage(c(locale, "Completing or cancelling an action requires a 10-character reason.", "Aksiyon tamamlama veya iptal için en az 10 karakter gerekçe gerekir.")); return; }
    setBusy(action.id); setMessage(null);
    try {
      const response = await fetch(`/api/employee-relations/cases/${encodeURIComponent(caseId)}/actions/${encodeURIComponent(action.id)}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: targetStatus, ...(actionReason ? { reason: actionReason } : {}) }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Corrective action update failed.");
      setActionReasons((current) => ({ ...current, [action.id]: "" })); setMessage(c(locale, "Corrective action updated.", "Düzeltici aksiyon güncellendi."));
      await acknowledgeNotifications("CaseAction", action.id);
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : c(locale, "Corrective action update failed.", "Düzeltici aksiyon güncellenemedi.")); }
    finally { setBusy(null); }
  }

  return <details style={{ minWidth: 280 }} open={Boolean(focusedActionId)}>
    <summary style={{ cursor: "pointer", fontWeight: 700 }}>{c(locale, "Govern case", "Vakayı yönet")}</summary>
    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
      {options.length ? <div style={{ display: "grid", gap: 7 }}>
        <strong>{c(locale, "Case transition", "Vaka geçişi")}</strong>
        <select value={target} onChange={(event) => setTarget(event.target.value as CaseStatus)} disabled={busy !== null}>{options.map((option) => <option key={option} value={option}>{label(locale, option)}</option>)}</select>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={2000} rows={2} placeholder={c(locale, "Reason for governed transition", "Yönetişimli geçiş gerekçesi")}/>
        <button type="button" onClick={changeCase} disabled={busy !== null || !target}>{busy === "case" ? c(locale, "Saving…", "Kaydediliyor…") : c(locale, "Apply case transition", "Vaka geçişini uygula")}</button>
      </div> : <small>{c(locale, "Case is terminal.", "Vaka terminal durumda.")}</small>}

      {actions.filter((action) => actionTransitions[action.status].length).map((action) => <div key={action.id} aria-current={action.id === focusedActionId ? "true" : undefined} style={{ display: "grid", gap: 6, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
        <strong>{action.actionType}{action.id === focusedActionId ? ` · ${c(locale, "Focused", "Odak")}` : ""}</strong><small>{label(locale, action.status)} · {c(locale, "Owner", "Sahip")}: {action.ownerId}</small>
        <textarea value={actionReasons[action.id] ?? ""} onChange={(event) => setActionReasons((current) => ({ ...current, [action.id]: event.target.value }))} minLength={10} maxLength={2000} rows={2} placeholder={c(locale, "Completion / cancellation reason", "Tamamlama / iptal gerekçesi")}/>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{actionTransitions[action.status].map((next) => <button key={next} type="button" onClick={() => changeAction(action, next)} disabled={busy !== null}>{label(locale, next)}</button>)}</div>
      </div>)}
      {message ? <small aria-live="polite">{message}</small> : null}
    </div>
  </details>;
}
