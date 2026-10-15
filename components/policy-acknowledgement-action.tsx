"use client";

import { CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { isRecord, policyActionMessage, usePolicyAction } from "@/components/policy-action-state";

export function PolicyAcknowledgementAction({ policyId, status }: { policyId: string; status: string | null }) {
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const normalized = status?.toUpperCase();
  const state = usePolicyAction(JSON.stringify([policyId, normalized]));
  const message = policyActionMessage(state.phase, locale);
  // A waiver is an exemption, not evidence that this employee acknowledged.
  if (normalized === "WAIVED") return <span className="matrix-note" data-policy-ack-state="waived"><ShieldCheck size={12}/> {c("Waived", "Muaf")}</span>;
  if (normalized === "ACKNOWLEDGED") return <span className="matrix-note" data-policy-ack-state="acknowledged"><CheckCircle2 size={12}/> {c("Acknowledged", "Onaylandı")}</span>;

  function acknowledge() {
    void state.run({ action: "ACKNOWLEDGE", confirmation: c("Confirm that you have read and acknowledge this policy?", "Bu politikayı okuduğunuzu ve onayladığınızı doğruluyor musunuz?"),
      url: `/api/policies/${encodeURIComponent(policyId)}/acknowledgements`,
      init: { method: "POST", headers: { "x-purpose": "Policy acknowledgement" } }, expectedStatus: 201, events: ["hrbp:lifecycle-actions-changed", "hrbp:notifications-changed"],
      accepts: data => isRecord(data) && typeof data.id === "string" && data.id.length > 0 && data.policyId === policyId
        && typeof data.policyVersion === "string" && data.policyVersion.trim().length > 0
        && typeof data.acknowledgedAt === "string" && Number.isFinite(Date.parse(data.acknowledgedAt)) });
  }
  return <div className="comp-decision-wrap" data-policy-acknowledgement={policyId} aria-busy={state.phase === "pending"}>
    <button type="button" className="mini-action approve" disabled={state.blocked} onClick={acknowledge}>
      {state.phase === "pending" ? <LoaderCircle size={13}/> : <CheckCircle2 size={13}/>} {c("Acknowledge", "Okudum / Onayla")}
    </button>
    {message ? <><small role={state.phase === "saved" ? "status" : "alert"} className={state.phase === "saved" ? "matrix-note" : "comp-decision-error"}>{message}</small>
      <button type="button" className="mini-action apply" onClick={state.reload}>{c("Reload current record", "Güncel kaydı yeniden yükle")}</button></> : null}
  </div>;
}
