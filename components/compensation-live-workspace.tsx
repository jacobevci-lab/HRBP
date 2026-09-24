import Link from "next/link";
import { BadgeDollarSign, Clock3, LockKeyhole, ShieldCheck, TrendingUp } from "lucide-react";
import { can } from "@/lib/authorization";
import { getCompensationWorkspaceData } from "@/lib/compensation-live-data";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";
import { getServerRequestContext } from "@/lib/server-session";
import { CompensationCreateConsole } from "@/components/compensation-create-console";
import { CompensationDecisionButtons } from "@/components/compensation-decision-buttons";

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }

function Stat({ label, value, meta, icon: Icon }: { label: string; value: string; meta: string; icon: React.ComponentType<{ size?: number }> }) {
  return <div className="enterprise-stat"><div className="enterprise-stat-icon"><Icon size={17}/></div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function money(locale: Locale, currency: string, amount: string | number) {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString(locale === "tr" ? "tr-TR" : "en-US", { maximumFractionDigits: 0 })}`;
  }
}

function statusLabel(locale: Locale, value: string) {
  if (locale !== "tr") return value;
  const labels: Record<string, string> = {
    "Awaiting Approval": "Onay Bekliyor",
    Approved: "Onaylandı",
    Applied: "Uygulandı",
    Rejected: "Reddedildi",
    Draft: "Taslak",
    Approval: "Onay",
    Cancelled: "İptal"
  };
  return labels[value] ?? value;
}

function Restricted({ detail, locale }: { detail: string; locale: Locale }) {
  return <div className="card employee-restricted-card"><LockKeyhole size={22}/><div><h3>{c(locale,"Compensation is a restricted domain","Ücretlendirme kısıtlı bir alandır")}</h3><p>{detail}</p><Link className="secondary-button" style={{ marginTop: 12 }} href={`/auth/sign-in?returnTo=${encodeURIComponent("/module/compensation")}`}>{c(locale,"Sign in with enterprise SSO","Kurumsal SSO ile giriş yap")}</Link></div></div>;
}

export async function CompensationLiveWorkspace() {
  const locale = await getServerLocale();
  const ctx = await getServerRequestContext();
  if (!ctx) return <Restricted locale={locale} detail={c(locale,"Salary, compensation history and approval queues are never exposed through the public staging surface.","Maaş, ücret geçmişi ve onay kuyrukları genel staging yüzeyinde hiçbir zaman gösterilmez.")}/>;
  if (!can(ctx, "compensation:read")) return <Restricted locale={locale} detail={c(locale,"Your current role does not include compensation:read. Tenant administration alone does not grant salary access.","Mevcut rolünüz compensation:read yetkisini içermiyor. Tenant yönetimi tek başına maaş verisine erişim sağlamaz.")}/>;

  const data = await getCompensationWorkspaceData(ctx);
  const canPropose = can(ctx, "compensation:propose");
  const canApprove = can(ctx, "compensation:approve");
  const canApply = can(ctx, "compensation:apply");
  const showControls = canPropose || canApprove || canApply;
  const totalSummary = data.currencies.length
    ? data.currencies.slice(0, 2).map((entry) => `${entry.currency} ${money(locale, entry.currency, entry.total)}`).join(" · ")
    : c(locale,"No active base salary records","Aktif baz maaş kaydı yok");

  return <>
    <div className="enterprise-stats"><Stat label={c(locale,"Current salary records","Mevcut maaş kayıtları")} value={String(data.currentRecords)} meta={totalSummary} icon={BadgeDollarSign}/><Stat label={c(locale,"Awaiting approval","Onay bekleyen")} value={String(data.pending)} meta={c(locale,"Four-eyes decision required","Dört göz kararı gerekli")} icon={Clock3}/><Stat label={c(locale,"Approved / scheduled","Onaylı / planlı")} value={String(data.approved)} meta={c(locale,"Ready for effective-dated apply","Geçerlilik tarihli uygulamaya hazır")} icon={TrendingUp}/><Stat label={c(locale,"Applied changes","Uygulanan değişiklikler")} value={String(data.applied)} meta={c(locale,"Payroll handoff emitted","Bordro devir bildirimi üretildi")} icon={ShieldCheck}/></div>
    <section className="card compensation-governance-note"><ShieldCheck size={20}/><div><strong>{c(locale,"Restricted compensation control plane","Kısıtlı ücretlendirme kontrol katmanı")}</strong><p>{c(locale,"Proposals, approvals and effective-dated application use separate capabilities. The requester cannot approve or apply their own change. Current salary is resolved server-side for the proposal date, revalidated before application, and a payroll handoff event is written only after the effective-dated history transaction commits.","Teklif, onay ve tarih-etkin uygulama ayrı yetkiler kullanır. Talebi oluşturan kişi kendi değişikliğini onaylayamaz veya uygulayamaz. Mevcut maaş teklif tarihi için sunucuda çözülür, uygulama öncesinde tekrar doğrulanır ve bordro devir olayı yalnız tarih-etkin geçmiş işlemi başarıyla tamamlandığında yazılır.")}</p></div></section>
    {canPropose ? <CompensationCreateConsole employments={data.eligibleEmployments}/> : null}
    <div className="card enterprise-table-card"><div className="table-title"><div><h3>{c(locale,"Compensation change queue","Ücret değişikliği kuyruğu")}</h3><p>{c(locale,"Live relationship-scoped proposals with immutable approval evidence, baseline revalidation and payroll handoff controls.","Değiştirilemez onay kanıtı, baz maaş yeniden doğrulaması ve bordro devir kontrolleriyle ilişki kapsamlı canlı teklifler.")}</p></div><span>{data.rows.length} {c(locale,"records","kayıt")}</span></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>{c(locale,"Employee","Çalışan")}</th><th>{c(locale,"Current → proposed","Mevcut → önerilen")}</th><th>{c(locale,"Effective","Geçerlilik")}</th><th>{c(locale,"Status","Durum")}</th><th>{c(locale,"Reason","Gerekçe")}</th><th>{c(locale,"Requester / approver","Talep eden / onaylayan")}</th>{showControls ? <th>{c(locale,"Governed action","Yönetişimli aksiyon")}</th> : null}</tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong className="cell-strong">{row.employee}</strong><small className="cell-sub">{row.employeeNumber} · {row.position} · {row.organization}</small></td><td>{row.currentAnnualBase ? <><span>{money(locale, row.currency, row.currentAnnualBase)}</span><small className="cell-sub">→ {money(locale, row.currency, row.proposedAnnualBase)}</small></> : <><span>{c(locale,"No prior governed base","Önceki yönetişimli baz yok")}</span><small className="cell-sub">→ {money(locale, row.currency, row.proposedAnnualBase)}</small></>}</td><td>{row.effectiveAt}</td><td><em className={`pill ${row.status.toLowerCase().replaceAll(" ", "-")}`}>{statusLabel(locale,row.status)}</em></td><td>{row.reason}</td><td><code>{row.requestedById}</code>{row.approvedById ? <small className="cell-sub">{c(locale,"Approved by","Onaylayan")}: {row.approvedById}</small> : null}</td>{showControls ? <td><CompensationDecisionButtons changeId={row.id} status={row.rawStatus} canSubmit={canPropose} canApprove={canApprove} canApply={canApply} isRequester={row.requestedById === ctx.actorId}/></td> : null}</tr>) : <tr><td colSpan={showControls ? 7 : 6} style={{ textAlign: "center", padding: 28 }}>{c(locale,"No compensation change requests are recorded in your authorized population.","Yetkili çalışan kapsamınızda kayıtlı ücret değişikliği talebi bulunmuyor.")}</td></tr>}</tbody></table></div></div>
  </>;
}
