"use client";

import { Check, LoaderCircle, Pause, Play, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

type DefinitionAction = "ACTIVATE" | "PAUSE" | "RETIRE";

export function WorkflowDefinitionActions({
  definitionId,
  status,
  createdById,
  actorId,
  canApprove
}: {
  definitionId: string;
  status: string;
  createdById: string;
  actorId: string;
  canApprove: boolean;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [busy, setBusy] = useState<DefinitionAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const creator = createdById === actorId;

  async function transition(action: DefinitionAction) {
    if (action === "RETIRE" && !window.confirm(c("Retire this workflow definition?", "Bu iş akışı tanımını emekliye ayırmak istiyor musunuz?"))) return;
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/workflows/definitions/${encodeURIComponent(definitionId)}/lifecycle`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-purpose": "Workflow definition governance" },
        body: JSON.stringify({ action })
      });
      const value = await response.json() as { error?: string };
      if (!response.ok) {
        setError(value.error || c("Workflow definition action failed.", "İş akışı tanımı aksiyonu başarısız oldu."));
        return;
      }
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
      window.dispatchEvent(new Event("hrbp:notifications-changed"));
      router.refresh();
    } catch {
      setError(c("Workflow service could not be reached.", "İş akışı servisine ulaşılamadı."));
    } finally {
      setBusy(null);
    }
  }

  if (!canApprove) return null;

  return <div className="comp-decision-wrap">
    <div className="comp-decision-buttons">
      {(status === "DRAFT" || status === "PAUSED") && !creator ? <button type="button" className="mini-action approve" disabled={!!busy} onClick={() => void transition("ACTIVATE")}>{busy === "ACTIVATE" ? <LoaderCircle size={13}/> : <Play size={13}/>} {c("Activate","Aktifleştir")}</button> : null}
      {status === "ACTIVE" ? <button type="button" className="mini-action reject" disabled={!!busy} onClick={() => void transition("PAUSE")}>{busy === "PAUSE" ? <LoaderCircle size={13}/> : <Pause size={13}/>} {c("Pause","Duraklat")}</button> : null}
      {(status === "DRAFT" || status === "PAUSED") ? <button type="button" className="mini-action reject" disabled={!!busy} onClick={() => void transition("RETIRE")}>{busy === "RETIRE" ? <LoaderCircle size={13}/> : <Trash2 size={13}/>} {c("Retire","Emekliye ayır")}</button> : null}
    </div>
    {(status === "DRAFT" || status === "PAUSED") && creator ? <small className="comp-decision-error"><ShieldCheck size={11}/> {c("Four-eyes: creator cannot activate this definition.","Dört göz: oluşturan kişi bu tanımı aktive edemez.")}</small> : null}
    {status === "ACTIVE" ? <small className="matrix-note"><Check size={11}/> {c("Active governed definition","Aktif yönetişimli tanım")}</small> : null}
    {error ? <small className="comp-decision-error">{error}</small> : null}
  </div>;
}
