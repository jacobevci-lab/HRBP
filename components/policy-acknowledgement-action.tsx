"use client";

import { CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { isRecord, policyActionMessage, usePolicyAction } from "@/components/policy-action-state";
import { PolicyAcknowledgementReader, type PolicyReadSnapshot } from "@/components/policy-acknowledgement-reader";

type Props = { policyId: string; status: string | null };
export function PolicyAcknowledgementAction(props: Props) {
  if (["WAIVED", "ACKNOWLEDGED"].includes(props.status?.toUpperCase() ?? "")) return <BoundPolicyAcknowledgementAction {...props}/>;
  return <PolicyAcknowledgementReader key={props.policyId} policyId={props.policyId}
    renderAction={snapshot => <BoundPolicyAcknowledgementAction {...props} snapshot={snapshot}/>}/>;
}

export function BoundPolicyAcknowledgementAction({ policyId, status, snapshot }: Props & { snapshot?: PolicyReadSnapshot }) {
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const normalized = status?.toUpperCase();
  const state = usePolicyAction(JSON.stringify([policyId, normalized, snapshot?.version, snapshot?.contentHash]));
  const message = policyActionMessage(state.phase, locale);
  if (normalized === "WAIVED") return <span className="matrix-note" data-policy-ack-state="waived"><ShieldCheck size={12}/> {c("Waived", "Muaf")}</span>;
  if (normalized === "ACKNOWLEDGED") return <span className="matrix-note" data-policy-ack-state="acknowledged"><CheckCircle2 size={12}/> {c("Acknowledged", "Onaylandı")}</span>;
  const bound = snapshot?.id === policyId && Boolean(snapshot.version?.trim()) && /^[a-f0-9]{64}$/.test(snapshot.contentHash);
  function acknowledge() {
    if (!bound || !snapshot) return;
    void state.run({ action: "ACKNOWLEDGE", confirmation: c("Confirm that you have read and acknowledge this policy version?", "Bu politika sürümünü okuduğunuzu ve onayladığınızı doğruluyor musunuz?"),
      url: `/api/policies/${encodeURIComponent(policyId)}/acknowledgements`,
      init: { method: "POST", headers: { "content-type": "application/json", "x-purpose": "Policy acknowledgement" },
        body: JSON.stringify({ policyVersion: snapshot.version, contentHash: snapshot.contentHash }) },
      expectedStatus: 201, events: ["hrbp:lifecycle-actions-changed", "hrbp:notifications-changed"],
      accepts: data => isRecord(data) && typeof data.id === "string" && data.id.length > 0 && data.policyId === policyId
        && data.policyVersion === snapshot.version && data.policyContentHash === snapshot.contentHash
        && typeof data.acknowledgedAt === "string" && Number.isFinite(Date.parse(data.acknowledgedAt)) });
  }
  return <div className="comp-decision-wrap" data-policy-acknowledgement={policyId} aria-busy={state.phase === "pending"}>
    <button type="button" className="mini-action approve" disabled={state.blocked || !bound} onClick={acknowledge}>
      {state.phase === "pending" ? <LoaderCircle size={13}/> : <CheckCircle2 size={13}/>} {c("Acknowledge", "Okudum / Onayla")}
    </button>
    {message ? <><small role={state.phase === "saved" ? "status" : "alert"} className={state.phase === "saved" ? "matrix-note" : "comp-decision-error"}>{message}</small>
      <button type="button" className="mini-action apply" onClick={state.reload}>{c("Reload current record", "Güncel kaydı yeniden yükle")}</button></> : null}
  </div>;
}
