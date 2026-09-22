import Link from "next/link";
import { BadgeDollarSign, Clock3, LockKeyhole, ShieldCheck, TrendingUp } from "lucide-react";
import { can } from "@/lib/authorization";
import { getCompensationWorkspaceData } from "@/lib/compensation-live-data";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";
import { getServerRequestContext } from "@/lib/server-session";
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
    Approval: "Onay"
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
  const canWrite = can(ctx, "compensation:write");
  const totalSummary = data.currencies.length
    ? data.currencies.slice(0, 2).map((entry) => `${entry.currency} ${money(locale, entry.currency, entry.total)}`).join(" · ")
    : c(locale,"No active base salary records","Aktif baz maaş kaydı yok");

  return <>
    <div className="enterprise-stats"><Stat label={c(locale,"Current salary records","Mevcut maaş kayıtları")} value={String(data.currentRecords)} meta={totalSummary} icon={BadgeDollarSign}/><Stat label={c(locale,"Awaiting approval","Onay bekleyen")} value={String(data.pending)} meta={c(locale,"Four-eyes decision required","Dört göz kararı gerekli")} icon={Clock3}/><Stat label={c(locale,"Approved / scheduled","Onaylı / planlı")} value={String(data.approved)} meta={c(locale,"Ready for effective-dated apply","Geçerlilik tarihli uygulamaya hazır")} icon={TrendingUp}/><Stat label={c(locale,"Applied changes","Uygulanan değişiklikler")} value={String(data.applied)} meta={c(locale,"Historical records preserved","Geçmiş kayıtlar korunur")} icon={ShieldCheck}/></div>
    <section className="card compensation-governance-note"><ShieldCheck size={20}/><div><strong>{c(locale,"Restricted approval boundary","Kısıtlı onay sınırı")}</strong><p>{c(locale,"Requesters cannot approve or apply their own compensation changes. Approved values create a new effective-dated salary record; prior history is closed, never overwritten. Relationship scope is enforced before restricted salary data is loaded.","Talebi oluşturan kişi kendi ücret değişikliğini onaylayamaz veya uygulayamaz. Onaylanan değer yeni bir geçerlilik tarihli maaş kaydı oluşturur; önceki geçmiş kapanır ve üzerine yazılmaz. Kısıtlı maaş verisi yüklenmeden önce ilişki kapsamı zorunlu olarak uygulanır.")}</p></div></section>
    <div className="card enterprise-table-card"><div className="table-title"><div><h3>{c(locale,"Compensation change queue","Ücret değişikliği kuyruğu")}</h3><p>{c(locale,"Live relationship-scoped requests from PostgreSQL with restricted authorization and audit evidence.","PostgreSQL'den ilişki kapsamlı canlı talepler; kısıtlı yetkilendirme ve denetim kanıtıyla birlikte gösterilir.")}</p></div><span>{data.rows.length} {c(locale,"records","kayıt")}</span></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>{c(locale,"Employee","Çalışan")}</th><th>{c(locale,"Current → proposed","Mevcut → önerilen")}</th><th>{c(locale,"Effective","Geçerlilik")}</th><th>{c(locale,"Status","Durum")}</th><th>{c(locale,"Reason","Gerekçe")}</th><th>{c(locale,"Requester / approver","Talep eden / onaylayan")}</th>{canWrite ? <th>{c(locale,"Decision","Karar")}</th> : null}</tr></thead><tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id}><td><strong className="cell-strong">{row.employee}</strong><small className="cell-sub">{row.employeeNumber} · {row.position} · {row.organization}</small></td><td>{row.currentAnnualBase ? <><span>{money(locale, row.currency, row.currentAnnualBase)}</span><small className="cell-sub">→ {money(locale, row.currency, row.proposedAnnualBase)}</small></> : <strong className="cell-strong">{money(locale, row.currency, row.proposedAnnualBase)}</strong>}</td><td>{row.effectiveAt}</td><td><em className={`pill ${row.status.toLowerCase().replaceAll(" ", "-")}`}>{statusLabel(locale,row.status)}</em></td><td>{row.reason}</td><td><code>{row.requestedById}</code>{row.approvedById ? <small className="cell-sub">{c(locale,"Approved","Onaylayan")}: {row.approvedById}</small> : null}</td>{canWrite ? <td><CompensationDecisionButtons changeId={row.id} status={row.rawStatus}/></td> : null}</tr>) : <tr><td colSpan={canWrite ? 7 : 6} style={{ textAlign: "center", padding: 28 }}>{c(locale,"No compensation change requests are recorded in your authorized population.","Yetkili çalışan kapsamınızda kayıtlı ücret değişikliği talebi bulunmuyor.")}</td></tr>}</tbody></table></div></div>
  </>;
}
