"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { positionBulkCriticalityAction } from "@/lib/position-bulk-action";
import type { PositionBulkActionState } from "@/lib/position-bulk-action";
import type { Locale } from "@/lib/i18n";

function messageFor(locale: Locale, state: PositionBulkActionState) {
  const tr = locale === "tr";
  if (state.ok) {
    if (!state.changed) return tr ? "Seçili pozisyonlarda değişiklik gerekmedi." : "No changes were needed for the selected positions.";
    return state.critical
      ? (tr ? `${state.changed} pozisyon kritik olarak işaretlendi.` : `${state.changed} positions marked critical.`)
      : (tr ? `${state.changed} pozisyonun kritik işareti kaldırıldı.` : `${state.changed} positions cleared from critical.`);
  }
  if (!state.code) return "";
  if (state.code === "auth") return tr ? "Oturum doğrulanamadı." : "Session could not be verified.";
  if (state.code === "invalid") return tr ? "1–100 geçerli pozisyon seçin." : "Select 1–100 valid positions.";
  if (state.code === "forbidden") return tr ? "Toplu pozisyon güncelleme yetkiniz yok." : "You are not authorized to bulk-update positions.";
  if (state.code === "scope") return tr ? "Seçim güncelliğini yitirdi veya kapsam dışı kayıt içeriyor. Sayfayı yenileyin." : "The selection is stale or contains an out-of-scope record. Refresh and review.";
  if (state.code === "conflict") return tr ? "Pozisyonlar işlem sırasında değişti. Hiçbir kısmi sonuç kabul edilmedi." : "Positions changed during the transaction. No partial result was accepted.";
  return tr ? "Toplu işlem şu anda tamamlanamıyor." : "The bulk action cannot be completed right now.";
}

function BulkButton({ operation, disabled, children }: {
  operation: "mark-critical" | "clear-critical";
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return <button className="secondary-button position-bulk-button" type="submit" name="operation" value={operation} disabled={disabled || pending}>
    {children}
  </button>;
}

export function PositionBulkActionForm({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const tr = locale === "tr";
  const initial: PositionBulkActionState = { ok: false };
  const [state, action] = useActionState(positionBulkCriticalityAction, initial);
  const [selected, setSelected] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const message = messageFor(locale, state);

  function syncSelected() {
    const form = formRef.current;
    if (!form) return;
    const checked = form.querySelectorAll<HTMLInputElement>('input[name="positionIds"]:checked').length;
    setSelected(checked);
    const selectAll = form.querySelector<HTMLInputElement>("[data-position-select-all]");
    const total = form.querySelectorAll<HTMLInputElement>('input[name="positionIds"]').length;
    if (selectAll) {
      selectAll.checked = total > 0 && checked === total;
      selectAll.indeterminate = checked > 0 && checked < total;
    }
  }

  useEffect(() => {
    if (!state.ok) return;
    const form = formRef.current;
    if (!form) return;
    form.querySelectorAll<HTMLInputElement>('input[name="positionIds"],[data-position-select-all]').forEach((input) => {
      input.checked = false;
      input.indeterminate = false;
    });
    setSelected(0);
  }, [state.ok, state.changed, state.critical]);

  return <form
    ref={formRef}
    action={action}
    className="position-bulk-form"
    onChange={(event) => {
      const target = event.target as HTMLInputElement;
      if (target.matches("[data-position-select-all]")) {
        formRef.current?.querySelectorAll<HTMLInputElement>('input[name="positionIds"]').forEach((input) => {
          input.checked = target.checked;
        });
      }
      syncSelected();
    }}
    onSubmit={(event) => {
      if (!selected) {
        event.preventDefault();
        return;
      }
      const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      const marking = submitter?.value === "mark-critical";
      const prompt = marking
        ? (tr ? `${selected} pozisyon kritik olarak işaretlensin mi?` : `Mark ${selected} positions as critical?`)
        : (tr ? `${selected} pozisyonun kritik işareti kaldırılsın mı?` : `Clear critical status from ${selected} positions?`);
      if (!window.confirm(prompt)) event.preventDefault();
    }}
  >
    <div className="position-bulk-bar">
      <div>
        <span>{tr ? "Toplu işlem" : "Bulk action"}</span>
        <strong>{selected ? (tr ? `${selected} seçili` : `${selected} selected`) : (tr ? "Pozisyon seçin" : "Select positions")}</strong>
      </div>
      <div className="position-bulk-actions">
        <BulkButton operation="mark-critical" disabled={!selected}><ShieldAlert size={14}/>{tr ? "Kritik işaretle" : "Mark critical"}</BulkButton>
        <BulkButton operation="clear-critical" disabled={!selected}><ShieldCheck size={14}/>{tr ? "Kritik işaretini kaldır" : "Clear critical"}</BulkButton>
      </div>
      {message ? <small className={state.ok ? "position-bulk-success" : "position-bulk-error"} role={state.ok ? "status" : "alert"}>{message}</small> : null}
    </div>
    {children}
  </form>;
}
