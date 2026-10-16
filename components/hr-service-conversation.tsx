"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { useSessionContext } from "@/components/session-provider";
import { usePolicyDialog } from "@/components/use-policy-dialog";
import { parseConversationPage, type ConversationPage } from "@/components/hr-service-conversation-contract";
import styles from "@/components/hr-service-conversation.module.css";

type View = { key: string; phase: "idle" | "loading" | "ready" | "error"; data: ConversationPage | null };
type Read = { key: string; controller: AbortController };

export function HRServiceConversation({ requestId, locale }: { requestId: string; locale: Locale }) {
  const { session, loading } = useSessionContext();
  const user = session?.user;
  const key = JSON.stringify([requestId, user?.id, user?.tenantId, user?.role]);
  const allowed = Boolean(!loading && session?.authenticated && user);
  const latest = useRef({ key, allowed }); latest.current = { key, allowed };
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const openRef = useRef<string | null>(null), read = useRef<Read | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [view, setView] = useState<View>({ key, phase: "idle", data: null });
  const open = allowed && openKey === key && openRef.current === key;
  const data = open && view.key === key && view.phase === "ready" ? view.data : null;
  const pending = open && view.key === key && view.phase === "loading";
  const failed = open && view.key === key && view.phase === "error";
  const titleId = useId();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const date = (value: string) => new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";

  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  usePolicyDialog(dialog, open);
  useEffect(() => () => {
    if (read.current?.key === key) { read.current.controller.abort(); read.current = null; }
    if (openRef.current === key) openRef.current = null;
  }, [key, allowed]);

  function close() {
    openRef.current = null;
    read.current?.controller.abort(); read.current = null;
    setOpenKey(null); setView({ key, phase: "idle", data: null });
    if (dialog.current?.open) dialog.current.close();
    trigger.current?.focus();
  }
  async function load(before: string | null) {
    if (!user || !latest.current.allowed || latest.current.key !== key || openRef.current !== key || read.current) return;
    const token: Read = { key, controller: new AbortController() }; read.current = token;
    const current = () => latest.current.key === key && latest.current.allowed && openRef.current === key && read.current === token;
    // Discard the old page before re-authorizing, including on a failed refresh.
    setView({ key, phase: "loading", data: null });
    const timer = setTimeout(() => token.controller.abort(), 15000);
    try {
      const response = await fetch(`/api/hr-service/requests/${encodeURIComponent(requestId)}/conversation${before ? `?before=${encodeURIComponent(before)}` : ""}`, {
        cache: "no-store", credentials: "same-origin", redirect: "error", signal: token.controller.signal, headers: { Accept: "application/json" }
      });
      if (response.status !== 200 || response.redirected) throw new Error("UNAVAILABLE");
      const envelope: unknown = await response.json();
      const page = envelope && typeof envelope === "object" && !Array.isArray(envelope) ? parseConversationPage((envelope as { data?: unknown }).data, requestId, user, before) : null;
      if (!page) throw new Error("UNAVAILABLE");
      if (current()) setView({ key, phase: "ready", data: page });
    } catch {
      if (current()) setView({ key, phase: "error", data: null });
    } finally { clearTimeout(timer); if (read.current === token) read.current = null; }
  }
  function show() {
    if (!latest.current.allowed || latest.current.key !== key || openRef.current === key) return;
    openRef.current = key; setOpenKey(key); void load(null);
  }
  if (!allowed) return null;
  return <div className={styles.root} data-hr-service-conversation={requestId}>
    <button type="button" ref={trigger} className={styles.trigger} onClick={show}>{c("Conversation history", "Konuşma geçmişi")}</button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); close(); }} onClose={() => { if (!dialog.current?.open) close(); }}>
      <header className={styles.header}><h3 id={titleId}>{c("Request conversation", "Talep konuşması")}</h3><button type="button" onClick={close}>{c("Close", "Kapat")}</button></header>
      <div className={styles.body} aria-busy={pending}>
        {pending ? <p role="status">{c("Loading conversation…", "Konuşma yükleniyor…")}</p> : null}
        {failed ? <p role="alert">{c("The conversation could not be loaded. Access may have changed. Retry to read the latest page.", "Konuşma yüklenemedi. Erişim değişmiş olabilir. Son sayfayı okumak için yeniden deneyin.")}</p> : null}
        {data ? <>
          <section className={styles.request}><strong>{data.request.requestNumber}</strong><h4>{data.request.title}</h4><p>{data.request.description}</p></section>
          <p className={styles.hint}>{c("Up to 50 messages per page, oldest first. Open older pages to continue reading. Dates are UTC. This is a read-only view.", "Sayfa başına en fazla 50 mesaj, eskiden yeniye gösterilir. Okumaya devam etmek için eski sayfaları açın. Tarihler UTC'dir. Bu görünüm salt okunurdur.")}</p>
          {data.viewer.privateNotes ? <p className={styles.hint}>{c("Private HR notes are included for authorized service staff only.", "Özel İK notları yalnız yetkili hizmet ekibine gösterilir.")}</p> : null}
          {data.comments.length ? <ol className={styles.messages} aria-label={c("Messages", "Mesajlar")}>
            {data.comments.map(row => <li key={row.id} className={row.visibility === "PRIVATE_NOTE" ? styles.privateNote : styles.message} data-comment-id={row.id}>
              <div className={styles.meta}><strong>{row.authorName ?? c("Unavailable author", "Yazar bilgisi yok")}{row.own ? c(" (You)", " (Siz)") : ""}</strong><time dateTime={row.createdAt}>{date(row.createdAt)}</time></div>
              <span className={styles.badge}>{row.visibility === "PRIVATE_NOTE" ? c("Private HR note", "Özel İK notu") : c("Requester-visible reply", "Talep sahibine görünür yanıt")}</span><p>{row.body}</p>
            </li>)}
          </ol> : <p role="status">{c("There are no visible messages on this page.", "Bu sayfada görünür mesaj bulunmuyor.")}</p>}
          <p className={styles.hint}>{c(`${data.comments.length} messages on this page.`, `Bu sayfada ${data.comments.length} mesaj var.`)}</p>
        </> : null}
      </div>
      <footer className={styles.footer}>
        <button type="button" disabled={pending} onClick={() => void load(null)}>{failed ? c("Retry latest page", "Son sayfayı yeniden dene") : c("Refresh latest messages", "Son mesajları yenile")}</button>
        {data?.nextCursor ? <button type="button" disabled={pending} onClick={() => void load(data.nextCursor)}>{c("Older messages", "Daha eski mesajlar")}</button> : null}
      </footer>
    </dialog>
  </div>;
}
