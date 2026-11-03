"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Bookmark, BookmarkCheck, Check, Save, Trash2 } from "lucide-react";
import {
  deleteEnterpriseViewAction,
  saveEnterpriseViewAction
} from "@/lib/enterprise-saved-view-actions";
import type { SavedEnterpriseViewActionState } from "@/lib/enterprise-saved-view-actions";
import type {
  EnterpriseViewModule,
  EnterpriseViewState,
  SavedEnterpriseViewSummary
} from "@/lib/enterprise-saved-views";
import type { Locale } from "@/lib/i18n";

function sameState(left: EnterpriseViewState, right: EnterpriseViewState) {
  if (left.query !== right.query || left.status !== right.status || left.columnsCustomized !== right.columnsCustomized || left.density !== right.density || left.sortKey !== right.sortKey || left.sortDirection !== right.sortDirection) return false;
  if (!left.columnsCustomized) return true;
  return left.columns.length === right.columns.length && left.columns.every((value, index) => value === right.columns[index]);
}

function SaveButton({ tr }: { tr: boolean }) {
  const { pending } = useFormStatus();
  return <button className="secondary-button enterprise-save-view-button" type="submit" disabled={pending}>
    {pending ? <span className="enterprise-save-view-spinner" aria-hidden="true"/> : <Save size={14}/>}
    {pending ? (tr ? "Kaydediliyor" : "Saving") : (tr ? "Kaydet" : "Save")}
  </button>;
}

function messageFor(locale: Locale, state: { ok: boolean; code?: string }) {
  const tr = locale === "tr";
  if (state.ok) return tr ? "Görünüm kaydedildi." : "View saved.";
  if (!state.code) return "";
  if (state.code === "auth") return tr ? "Oturum doğrulanamadı." : "Session could not be verified.";
  if (state.code === "invalid") return tr ? "1–64 karakterlik geçerli bir ad girin." : "Enter a valid 1–64 character name.";
  if (state.code === "limit") return tr ? "Bu modül için en fazla 20 görünüm kaydedilebilir." : "Up to 20 views can be saved for this module.";
  if (state.code === "forbidden") return tr ? "Bu görünümü kaydetme yetkiniz yok." : "You are not authorized to save this view.";
  return tr ? "Görünüm şu anda kaydedilemiyor." : "The view cannot be saved right now.";
}

export function EnterpriseSavedViews({
  locale,
  moduleKey,
  current,
  savedViews
}: {
  locale: Locale;
  moduleKey: EnterpriseViewModule;
  current: EnterpriseViewState;
  savedViews: SavedEnterpriseViewSummary[];
}) {
  const tr = locale === "tr";
  const initialState: SavedEnterpriseViewActionState = { ok: false };
  const [state, formAction] = useActionState(saveEnterpriseViewAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const message = messageFor(locale, state);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return <details className="enterprise-saved-views">
    <summary>
      <Bookmark size={14}/>
      <span>{tr ? "Kayıtlı görünümler" : "Saved views"}</span>
      <small>{savedViews.length}</small>
    </summary>
    <div className="enterprise-saved-view-popover">
      <div className="enterprise-saved-view-head">
        <div><strong>{tr ? "Kayıtlı görünümler" : "Saved views"}</strong><small>{tr ? "Filtre ve sütun düzeninizi saklayın." : "Keep your filters and column layout."}</small></div>
        <span>{savedViews.length}/20</span>
      </div>

      <div className="enterprise-saved-view-list">
        {savedViews.length ? savedViews.map((view) => {
          const active = sameState(current, view.state);
          const detail = [
            view.state.query ? (tr ? "arama" : "search") : null,
            view.state.status ? view.state.status : null,
            view.state.columnsCustomized ? (tr ? `${view.state.columns.length} sütun` : `${view.state.columns.length} columns`) : (tr ? "varsayılan sütunlar" : "default columns"),
            view.state.density === "compact" ? (tr ? "kompakt" : "compact") : (tr ? "rahat" : "comfortable"),
            view.state.sortKey ? `${view.state.sortKey} ${view.state.sortDirection === "desc" ? "↓" : "↑"}` : null
          ].filter(Boolean).join(" · ");
          return <div className={`enterprise-saved-view-row ${active ? "active" : ""}`} key={view.id}>
            <Link href={view.href}>
              {active ? <BookmarkCheck size={15}/> : <Bookmark size={15}/>}
              <span><strong>{view.name}</strong><small>{detail}</small></span>
              {active ? <Check size={13}/> : null}
            </Link>
            <form action={deleteEnterpriseViewAction}>
              <input type="hidden" name="moduleKey" value={moduleKey}/>
              <input type="hidden" name="id" value={view.id}/>
              <button type="submit" aria-label={tr ? `${view.name} görünümünü sil` : `Delete ${view.name} view`} title={tr ? "Sil" : "Delete"}><Trash2 size={13}/></button>
            </form>
          </div>;
        }) : <div className="enterprise-saved-view-empty">{tr ? "Henüz kayıtlı görünüm yok." : "No saved views yet."}</div>}
      </div>

      <form ref={formRef} action={formAction} className="enterprise-save-view-form">
        <input type="hidden" name="moduleKey" value={moduleKey}/>
        <input type="hidden" name="query" value={current.query}/>
        <input type="hidden" name="status" value={current.status ?? ""}/>
        <input type="hidden" name="columnsMode" value={current.columnsCustomized ? "custom" : "default"}/>
        <input type="hidden" name="density" value={current.density}/>
        <input type="hidden" name="sort" value={current.sortKey ?? ""}/>
        <input type="hidden" name="dir" value={current.sortDirection}/>
        {current.columns.map((column) => <input key={column} type="hidden" name="columns" value={column}/>)}
        <label>
          <span>{tr ? "Mevcut görünümü kaydet" : "Save current view"}</span>
          <div><input name="name" required maxLength={64} autoComplete="off" placeholder={tr ? "Örn. Aktif çalışanlar" : "e.g. Active workforce"}/><SaveButton tr={tr}/></div>
        </label>
        {message ? <small className={state.ok ? "enterprise-saved-view-success" : "enterprise-saved-view-error"} role={state.ok ? "status" : "alert"}>{message}</small> : null}
      </form>
    </div>
  </details>;
}
