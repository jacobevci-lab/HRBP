"use client";

import { Check, LoaderCircle, RotateCcw, Send, Upload } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { isRecord, policyActionMessage, usePolicyAction } from "@/components/policy-action-state";

type ReviewAction = "SUBMIT" | "APPROVE" | "REQUEST_CHANGES" | "PUBLISH";
export function PolicyReviewActions({ policyId, status, ownerId, actorId, canWrite, canApprove }: {
  policyId: string; status: string; ownerId: string; actorId: string; canWrite: boolean; canApprove: boolean;
}) {
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const isOwner = ownerId === actorId;
  const state = usePolicyAction(JSON.stringify([policyId, status, ownerId, actorId, canWrite, canApprove]));
  const message = policyActionMessage(state.phase, locale);
  const allowed = (action: ReviewAction) => action === "SUBMIT" ? status === "DRAFT" && canWrite
    : action === "APPROVE" ? status === "REVIEW" && canApprove && !isOwner
    : action === "REQUEST_CHANGES" ? ["REVIEW", "APPROVED"].includes(status) && canApprove
    : status === "APPROVED" && canWrite;

  function act(action: ReviewAction) {
    if (!allowed(action)) return;
    const target = { SUBMIT: "REVIEW", APPROVE: "APPROVED", REQUEST_CHANGES: "DRAFT", PUBLISH: "PUBLISHED" }[action];
    const confirmation = {
      SUBMIT: c("Submit this policy for independent review?", "Bu politika bağımsız incelemeye gönderilsin mi?"),
      APPROVE: c("Approve this policy version?", "Bu politika sürümü onaylansın mı?"),
      REQUEST_CHANGES: c("Return this policy to draft for changes?", "Bu politika düzeltme için taslak durumuna döndürülsün mü?"),
      PUBLISH: c("Publish this approved policy?", "Bu onaylanmış politika yayınlansın mı?")
    }[action];
    void state.run({ action, confirmation, url: `/api/policies/${encodeURIComponent(policyId)}/${action === "PUBLISH" ? "publish" : "review"}`,
      init: action === "PUBLISH" ? { method: "POST", headers: { "x-purpose": "Policy publication" } }
        : { method: "POST", headers: { "content-type": "application/json", "x-purpose": "Policy governance review" }, body: JSON.stringify({ action }) },
      expectedStatus: 200, events: ["hrbp:lifecycle-actions-changed", "hrbp:notifications-changed"], accepts: data => isRecord(data) && data.id === policyId && data.status === target });
  }
  const pending = (action: ReviewAction) => state.phase === "pending" && state.action === action;
  return <div className="comp-decision-wrap" data-policy-review={policyId} aria-busy={state.phase === "pending"}>
    <div className="comp-decision-buttons">
      {allowed("SUBMIT") ? <button type="button" className="mini-action apply" disabled={state.blocked} onClick={() => act("SUBMIT")}>{pending("SUBMIT") ? <LoaderCircle size={13}/> : <Send size={13}/>} {c("Submit", "İncelemeye gönder")}</button> : null}
      {allowed("APPROVE") ? <button type="button" className="mini-action approve" disabled={state.blocked} onClick={() => act("APPROVE")}>{pending("APPROVE") ? <LoaderCircle size={13}/> : <Check size={13}/>} {c("Approve", "Onayla")}</button> : null}
      {allowed("REQUEST_CHANGES") ? <button type="button" className="mini-action reject" disabled={state.blocked} onClick={() => act("REQUEST_CHANGES")}>{pending("REQUEST_CHANGES") ? <LoaderCircle size={13}/> : <RotateCcw size={13}/>} {c("Changes", "Düzeltme iste")}</button> : null}
      {allowed("PUBLISH") ? <button type="button" className="mini-action apply" disabled={state.blocked} onClick={() => act("PUBLISH")}>{pending("PUBLISH") ? <LoaderCircle size={13}/> : <Upload size={13}/>} {c("Publish", "Yayınla")}</button> : null}
    </div>
    {status === "REVIEW" && canApprove && isOwner ? <small className="comp-decision-error">{c("Four-eyes: the policy owner cannot approve this version.", "Dört göz: politika sahibi bu sürümü onaylayamaz.")}</small> : null}
    {message ? <><small role={state.phase === "saved" ? "status" : "alert"} className={state.phase === "saved" ? "matrix-note" : "comp-decision-error"}>{message}</small>
      <button type="button" className="mini-action apply" onClick={state.reload}>{c("Reload current record", "Güncel kaydı yeniden yükle")}</button></> : null}
  </div>;
}
