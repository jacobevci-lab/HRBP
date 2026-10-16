"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { useSessionContext } from "@/components/session-provider";
import { usePolicyDialog } from "@/components/use-policy-dialog";
import { serviceActionMessage, useHRServiceAction, isObject } from "@/components/hr-service-action-state";
import { serviceStaffRoles } from "@/components/hr-service-receipts";
import { parseRoutingOptions, acceptsRoutingWrite, type RoutingOptions } from "@/components/hr-service-routing-contract";
import modal from "@/components/hr-service-conversation.module.css";
import fields from "@/components/hr-service-actions.module.css";

type View = { scope: string; phase: "idle" | "loading" | "ready" | "error"; data: RoutingOptions | null; assignee: string };
export function HRServiceRouting({ requestId, expectedUpdatedAt, status, locale }: { requestId: string; expectedUpdatedAt: string; status: string; locale: Locale }) {
  const { session, loading } = useSessionContext(), user = session?.user;
  const allowed = Boolean(!loading && session?.authenticated && user && serviceStaffRoles.has(user.role) && !["CLOSED", "CANCELLED"].includes(status));
  const key = JSON.stringify([requestId, user?.id, user?.tenantId, user?.role]);
  const scope = JSON.stringify([key, expectedUpdatedAt, status]);
  const latest = useRef({ scope, allowed }); latest.current = { scope, allowed };
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), openRef = useRef<string | null>(null);
  const read = useRef<AbortController | null>(null), [openScope, setOpenScope] = useState<string | null>(null);
  const [view, setView] = useState<View>({ scope, phase: "idle", data: null, assignee: "" });
  // The outcome key intentionally excludes revision: a refreshed prop or a
  // close/reopen must not erase an uncertain routing write.
  const action = useHRServiceAction(key, allowed);
  const open = allowed && openScope === scope && openRef.current === scope;
  const data = open && view.scope === scope && view.phase === "ready" ? view.data : null;
  const pending = open && view.scope === scope && view.phase === "loading";
  const failed = open && view.scope === scope && view.phase === "error";
  const titleId = useId(), c = (en: string, tr: string) => locale === "tr" ? tr : en;
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  usePolicyDialog(dialog, open);
  useEffect(() => () => { read.current?.abort(); read.current = null; openRef.current = null; }, [scope, allowed]);
  const applicable = () => latest.current.scope === scope && latest.current.allowed && openRef.current === scope;
  function close() {
    read.current?.abort(); read.current = null; openRef.current = null; setOpenScope(null);
    setView({ scope, phase: "idle", data: null, assignee: "" });
    if (dialog.current?.open) dialog.current.close(); trigger.current?.focus();
  }
  async function load(selected: string | null | undefined) {
    if (!user || !applicable() || read.current) return;
    const token = new AbortController(); read.current = token;
    setView({ scope, phase: "loading", data: null, assignee: "" });
    const timer = setTimeout(() => token.abort(), 15000);
    try {
      const query = selected === undefined ? "" : `?queue=${encodeURIComponent(selected ?? "")}`;
      const response = await fetch(`/api/hr-service/requests/${encodeURIComponent(requestId)}/routing-options${query}`, {
        credentials: "same-origin", cache: "no-store", redirect: "error", signal: token.signal, headers: { Accept: "application/json" }
      });
      if (response.status !== 200 || response.redirected) throw new Error("UNAVAILABLE");
      const body: unknown = await response.json();
      const result = isObject(body) ? parseRoutingOptions(body.data, user, requestId, expectedUpdatedAt, selected) : null;
      if (!result || result.request.status !== status) throw new Error("UNAVAILABLE");
      if (applicable() && read.current === token) setView({ scope, phase: "ready", data: result,
        assignee: selected === undefined ? result.request.assigneeId ?? "" : "" });
    } catch { if (applicable() && read.current === token) setView({ scope, phase: "error", data: null, assignee: "" }); }
    finally { clearTimeout(timer); if (read.current === token) read.current = null; }
  }
  function show() {
    if (!latest.current.allowed || latest.current.scope !== scope || openRef.current === scope) return;
    openRef.current = scope; setOpenScope(scope); void load(undefined);
  }
  const selectedValid = Boolean(data?.queueAvailable && (!view.assignee || data.assignees.some(a => a.id === view.assignee)));
  const changed = Boolean(data && (data.queue !== data.request.queue || (view.assignee || null) !== data.request.assigneeId));
  async function save() {
    if (!user || !data || !applicable() || action.blocked || !selectedValid || !changed) return;
    const selectedQueue = data.queue, assigneeId = view.assignee || null;
    const assigneeName = data.assignees.find(a => a.id === assigneeId)?.displayName ?? c("Unassigned", "Atanmamış");
    await action.run({ action: "ROUTING", url: `/api/hr-service/requests/${encodeURIComponent(requestId)}/status`, expectedStatus: 200,
      body: { expectedUpdatedAt, status, queue: selectedQueue, assigneeId }, isApplicable: applicable,
      confirmation: c(`Save routing for ${data.request.requestNumber}? Queue: ${selectedQueue ?? "No queue"}. Assignee: ${assigneeName}. Status will not change.`,
        `${data.request.requestNumber} yönlendirmesi kaydedilsin mi? Kuyruk: ${selectedQueue ?? "Kuyruk yok"}. Sorumlu: ${assigneeName}. Durum değişmeyecek.`),
      accepts: value => acceptsRoutingWrite(value, user, requestId, status, expectedUpdatedAt, selectedQueue, assigneeId) });
  }
  if (!allowed) return null;
  const message = serviceActionMessage(action.phase, locale);
  return <div className={modal.root} data-hr-service-routing={requestId}>
    <button type="button" ref={trigger} onClick={show}>{c("Route / assign", "Yönlendir / ata")}</button>
    {!open && message ? <small role={action.phase === "saved" ? "status" : "alert"}>{message}</small> : null}
    <dialog ref={dialog} className={modal.dialog} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); close(); }} onClose={() => { if (!dialog.current?.open) close(); }}>
      <header className={modal.header}><h3 id={titleId}>{c("Request routing", "Talep yönlendirme")}</h3><button type="button" onClick={close}>{c("Close", "Kapat")}</button></header>
      <div className={modal.body} aria-busy={pending || action.phase === "pending"}>
        {pending ? <p role="status">{c("Loading routing choices…", "Yönlendirme seçenekleri yükleniyor…")}</p> : null}
        {failed ? <p role="alert">{c("Choices could not be verified. Access or the request may have changed. Retry the read or reload the current request.", "Seçenekler doğrulanamadı. Erişim veya talep değişmiş olabilir. Okumayı tekrar deneyin veya güncel talebi yeniden yükleyin.")}</p> : null}
        {data ? <div className={fields.form}>
          <strong>{data.request.requestNumber} · {data.request.title}</strong>
          <p className={fields.hint}>{c("This changes routing only, not the request status or its SLA history. Changing queue clears the proposed assignee until you choose again.", "Bu işlem yalnız yönlendirmeyi değiştirir; talep durumunu veya SLA geçmişini değiştirmez. Kuyruk değiştiğinde sorumlu yeniden seçilmelidir.")}</p>
          <label className={fields.field}>{c("Queue", "Kuyruk")}<select aria-label={c("Queue", "Kuyruk")} value={data.queue ?? ""} disabled={action.blocked} onChange={e => { if (applicable() && !action.blocked) void load(e.target.value || null); }}>
            <option value="">{c("No queue", "Kuyruk yok")}</option>
            {data.queue && !data.queues.some(q => q.key === data.queue) ? <option value={data.queue} disabled={!data.queueAvailable}>{data.queue} · {c("Current queue", "Mevcut kuyruk")}</option> : null}
            {data.queues.map(q => <option key={q.key} value={q.key}>{q.name} · {q.key}</option>)}
          </select></label>
          <label className={fields.field}>{c("Assignee", "Sorumlu")}<select aria-label={c("Assignee", "Sorumlu")} value={view.assignee} disabled={action.blocked || !data.queueAvailable} onChange={e => { if (applicable() && !action.blocked) setView({ ...view, assignee: e.target.value }); }}>
            <option value="">{c("Unassigned", "Atanmamış")}</option>
            {view.assignee && !data.assignees.some(a => a.id === view.assignee) ? <option value={view.assignee} disabled>{c("Current assignee unavailable — choose again", "Mevcut sorumlu kullanılamıyor — yeniden seçin")}</option> : null}
            {data.assignees.map(a => <option key={a.id} value={a.id}>{a.displayName}</option>)}
          </select></label>
          {!data.queueAvailable ? <p role="alert">{c("The current queue is unavailable. Select an authorized active queue or explicitly remove routing.", "Mevcut kuyruk kullanılamıyor. Yetkili aktif bir kuyruk seçin veya yönlendirmeyi açıkça kaldırın.")}</p> : null}
          {data.queuesTruncated || data.assigneesTruncated ? <p role="status">{c("Choice list is limited to 100 queues and 200 eligible staff; it is not the full directory.", "Seçenekler 100 kuyruk ve 200 uygun personelle sınırlıdır; tüm dizin değildir.")}</p> : null}
          <button type="button" onClick={save} disabled={action.blocked || !selectedValid || !changed}>{c("Save routing", "Yönlendirmeyi kaydet")}</button>
        </div> : null}
        {message ? <p role={action.phase === "saved" ? "status" : "alert"}>{message}</p> : null}
      </div>
      <footer className={modal.footer}>
        <button type="button" disabled={pending || action.phase === "pending"} onClick={() => void load(undefined)}>{c("Reload choices", "Seçenekleri yeniden oku")}</button>
        {failed || message ? <button type="button" onClick={action.reload}>{c("Reload current request", "Güncel talebi yeniden yükle")}</button> : null}
      </footer>
    </dialog>
  </div>;
}
