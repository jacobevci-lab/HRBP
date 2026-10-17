"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BookOpen, LoaderCircle, X } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import styles from "./policy-acknowledgement-reader.module.css";

export type PolicyReadSnapshot = { id: string; title: string; version: string; contentMarkdown: string; contentHash: string };

/** Validate the bytes actually rendered. No HTML/Markdown execution, images,
 * remote content or links are generated from an employee policy document. */
export async function checkedPolicySnapshot(value: unknown, id: string): Promise<PolicyReadSnapshot | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Partial<PolicyReadSnapshot>;
  if (data.id !== id || typeof data.title !== "string" || typeof data.version !== "string" || !data.version.trim()
    || data.version.length > 191 || typeof data.contentMarkdown !== "string" || !data.contentMarkdown.trim()
    || typeof data.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(data.contentHash)) return null;
  const bytes = new TextEncoder().encode(data.contentMarkdown);
  if (bytes.byteLength > 65_536) return null;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return hash === data.contentHash ? data as PolicyReadSnapshot : null;
}

export function PolicyAcknowledgementReader({ policyId, renderAction }: {
  policyId: string; renderAction: (snapshot: PolicyReadSnapshot) => ReactNode;
}) {
  const { locale } = useLocale(), titleId = useId();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null), currentId = useRef(policyId);
  const [snapshot, setSnapshot] = useState<PolicyReadSnapshot | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [read, setRead] = useState(false);
  currentId.current = policyId;
  useEffect(() => () => { request.current?.abort(); }, []);

  async function load() {
    if (request.current || snapshot) return;
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    setPhase("loading");
    try {
      const response = await fetch(`/api/policies/${encodeURIComponent(policyId)}/acknowledgements`, {
        method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal
      });
      if (!response.ok || response.redirected) throw new Error("Unavailable policy preview");
      const envelope: unknown = await response.json();
      const data = envelope && typeof envelope === "object" && !Array.isArray(envelope)
        ? await checkedPolicySnapshot((envelope as { data?: unknown }).data, policyId) : null;
      if (!data) throw new Error("Invalid policy preview");
      if (request.current !== controller || currentId.current !== policyId || controller.signal.aborted) return;
      setSnapshot(data); setRead(false); setPhase("ready");
    } catch {
      if (request.current === controller && currentId.current === policyId) setPhase("error");
    } finally { clearTimeout(timeout); if (request.current === controller) request.current = null; }
  }
  function open() { dialog.current?.showModal(); if (!snapshot) void load(); }
  function closed() {
    request.current?.abort(); request.current = null;
    if (!snapshot) setPhase("idle");
    trigger.current?.focus();
    // Keep the loaded snapshot and mounted action guard after closing. Reopen
    // must not discard an unknown/saved write state and allow a blind replay.
  }
  return <div className={styles.root} data-policy-reader={policyId}>
    <button ref={trigger} type="button" className="mini-action apply" onClick={open} aria-haspopup="dialog">
      <BookOpen size={13}/> {c("Read policy", "Politikayı oku")}
    </button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onClose={closed}>
      <div className={styles.header}>
        <h3 id={titleId}>{c("Policy content", "Politika içeriği")}</h3>
        <button type="button" className="mini-action" aria-label={c("Close policy", "Politikayı kapat")} onClick={() => dialog.current?.close()}><X size={16}/></button>
      </div>
      {phase === "loading" ? <p role="status"><LoaderCircle size={16}/> {c("Loading the assigned policy…", "Atanan politika yükleniyor…")}</p> : null}
      {phase === "error" ? <div role="alert">
        <p>{c("The policy could not be loaded or its content could not be verified. No acknowledgement was sent.", "Politika yüklenemedi veya içeriği doğrulanamadı. Onay isteği gönderilmedi.")}</p>
        <button type="button" className="mini-action apply" onClick={() => void load()}>{c("Retry reading", "Yeniden okumayı dene")}</button>
      </div> : null}
      {snapshot ? <>
        <h4 className={styles.title}>{snapshot.title}</h4>
        <p className={styles.meta}>{c("Version", "Sürüm")}: <strong>{snapshot.version}</strong><br/>SHA-256: <code>{snapshot.contentHash}</code></p>
        <pre className={styles.content} data-policy-content tabIndex={0}>{snapshot.contentMarkdown}</pre>
        <p className={styles.note}>{c("Plain text / Markdown source. Confirm only after reviewing this version. A checkbox does not establish that a person understood the content.", "Düz metin / Markdown kaynağı. Bu sürümü incelemeden onay vermeyin. İşaretleme, içeriğin anlaşıldığının kanıtı değildir.")}</p>
        <label className={styles.consent}><input type="checkbox" checked={read} onChange={e => setRead(e.target.checked)}/>
          <span>{c("I have read this version", "Bu sürümü okudum")}</span>
        </label>
        {/* Mount once and disable its container rather than unmounting the
            action on checkbox changes: local unknown-result guards survive. */}
        <fieldset disabled={!read} className={styles.action}>{renderAction(snapshot)}</fieldset>
      </> : null}
    </dialog>
  </div>;
}
