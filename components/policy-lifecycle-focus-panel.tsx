import { AlertTriangle, BookOpenCheck, ShieldCheck } from "lucide-react";
import { PolicyAcknowledgementButton } from "@/components/policy-acknowledgement-button";
import { PolicyExceptionDecisionButtons } from "@/components/policy-exception-actions";
import { PolicyReviewActions } from "@/components/policy-review-actions";
import { can } from "@/lib/authorization";
import { getServerLocale } from "@/lib/i18n-server";
import { getPolicyLifecycleFocusData, type PolicyLifecycleFocus } from "@/lib/policy-lifecycle-focus";
import { getServerRequestContext } from "@/lib/server-session";

function formatDate(value: string | null, locale: "en" | "tr") {
  if (!value) return locale === "tr" ? "Tarih yok" : "No due date";
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export async function PolicyLifecycleFocusPanel({ focus }: { focus: PolicyLifecycleFocus }) {
  if (!focus.policyId && !focus.exceptionId) return null;
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx || !can(ctx, "policies:read")) return null;
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const data = await getPolicyLifecycleFocusData(ctx, focus);

  if (!data.available) {
    return <section className="card module-degraded-banner" style={{ marginTop: 14, padding: "12px 14px", display: "flex", gap: 10, alignItems: "flex-start" }}>
      <AlertTriangle size={18}/><div><strong>{c("Requested policy action is not available", "İstenen politika aksiyonu kullanılamıyor")}</strong><p style={{ margin: "3px 0 0" }}>{c("The record is outside your signed policy scope, no longer actionable, or the four-eyes requirement excludes you. No broader record lookup was attempted.", "Kayıt imzalı politika kapsamınızın dışında, artık aksiyon alınabilir durumda değil veya dört-göz kuralı sizi dışlıyor. Daha geniş bir kayıt sorgusu denenmedi.")}</p></div>
    </section>;
  }

  const detail = data.kind === "exception"
    ? c(`Exception requested ${formatDate(data.exception.createdAt, locale)}${data.exception.expiresAt ? ` · expires ${formatDate(data.exception.expiresAt, locale)}` : ""}`, `İstisna talebi ${formatDate(data.exception.createdAt, locale)}${data.exception.expiresAt ? ` · bitiş ${formatDate(data.exception.expiresAt, locale)}` : ""}`)
    : data.kind === "acknowledgement"
      ? c(`Assigned ${formatDate(data.assignment.assignedAt, locale)} · due ${formatDate(data.assignment.dueAt, locale)}`, `Atama ${formatDate(data.assignment.assignedAt, locale)} · son tarih ${formatDate(data.assignment.dueAt, locale)}`)
      : c("Independent policy approval is required.", "Bağımsız politika onayı gerekiyor.");

  return <section className="card services-panel" style={{ marginTop: 14 }}>
    <div className="services-panel-head"><div><span className="section-kicker">{c("Lifecycle action focus", "Yaşam döngüsü aksiyon odağı")}</span><h3>{data.policy.code} · {data.policy.title}</h3></div><BookOpenCheck size={18}/></div>
    <div style={{ display: "grid", gap: 10 }}>
      <div className="governance-note" style={{ margin: 0 }}><ShieldCheck size={17}/><p><strong>v{data.policy.version} · {data.policy.status}</strong> {detail}</p></div>
      {data.kind === "review" ? <PolicyReviewActions policyId={data.policy.id} status={data.policy.status} ownerId={data.policy.ownerId} actorId={ctx.actorId} canWrite={can(ctx, "policies:write")} canApprove={can(ctx, "policies:approve")}/> : null}
      {data.kind === "exception" ? <PolicyExceptionDecisionButtons policyId={data.policy.id} exceptionId={data.exception.id} requestedById={data.exception.requestedById} actorId={ctx.actorId}/> : null}
      {data.kind === "acknowledgement" ? <PolicyAcknowledgementButton policyId={data.policy.id}/> : null}
    </div>
  </section>;
}
