import Link from "next/link";
import { BookOpenCheck, CalendarCheck2, ChevronRight, ClipboardCheck, Clock3, ShieldCheck, Target, UsersRound } from "lucide-react";
import { can } from "@/lib/authorization";
import { getServerLocale } from "@/lib/i18n-server";
import { getManagerHubData } from "@/lib/manager-hub-data";
import { getServerRequestContext } from "@/lib/server-session";

function c(locale: "en" | "tr", en: string, tr: string) { return locale === "tr" ? tr : en; }

function Stat({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="enterprise-stat"><div className="enterprise-stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

export async function ManagerHub() {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx) return <section className="card manager-hub-restricted"><ShieldCheck size={24}/><div><h3>{c(locale,"Authentication required","Kimlik doğrulama gerekli")}</h3><p>{c(locale,"Manager Hub uses live relationship-scoped workforce data.","Manager Hub canlı ve ilişki kapsamlı iş gücü verisini kullanır.")}</p></div></section>;

  const data = await getManagerHubData(ctx);
  if (!data) return <section className="card manager-hub-restricted"><ShieldCheck size={24}/><div><h3>{c(locale,"Manager Hub is role scoped","Manager Hub rol kapsamlıdır")}</h3><p>{c(locale,"This workspace is available only to authenticated people managers with a linked employment record.","Bu çalışma alanı yalnız bağlı istihdam kaydı bulunan kimliği doğrulanmış yöneticiler için kullanılabilir.")}</p></div></section>;

  const workHref = "/module/workflows";
  return <div className="manager-hub">
    <section className="page-heading module-heading manager-hub-heading">
      <div><div className="eyebrow">HRBP One / {c(locale,"My Team","Ekibim")}</div><h1>{c(locale,"Manager Hub","Yönetici Merkezi")}</h1><p>{c(locale,"Start with your direct reports, pending decisions and team attention — not the full HR module catalog.","Tüm İK modülleri yerine doğrudan bağlı çalışanlarınız, bekleyen kararlar ve ekip dikkat noktalarıyla başlayın.")}</p></div>
      <div className="module-heading-actions"><Link className="create-button" href={workHref}>{c(locale,"Open My Work","İşlerimi aç")}<ChevronRight size={15}/></Link></div>
    </section>

    <section className="enterprise-stats manager-hub-stats">
      <Stat icon={<UsersRound size={17}/>} label={c(locale,"Direct reports","Doğrudan bağlı")} value={String(data.teamSize)} meta={c(locale,"Live manager relationship","Canlı yönetici ilişkisi")}/>
      <Stat icon={<ClipboardCheck size={17}/>} label={c(locale,"Decisions & reviews","Karar & inceleme")} value={String(data.decisions)} meta={c(locale,"Leave, time and manager reviews","İzin, zaman ve yönetici değerlendirmeleri")}/>
      <Stat icon={<Target size={17}/>} label={c(locale,"Goals at risk","Riskli hedefler")} value={String(data.atRiskGoals)} meta={c(locale,"At-risk or overdue active goals","Riskli veya gecikmiş aktif hedefler")}/>
      <Stat icon={<BookOpenCheck size={17}/>} label={c(locale,"Learning attention","Eğitim dikkati")} value={String(data.learningAttention)} meta={c(locale,"Overdue or due within 7 days","Gecikmiş veya 7 gün içinde")}/>
    </section>

    <section className="manager-hub-actions">
      {can(ctx,"leave:read") ? <Link href="/module/workflows?view=leave" className="manager-hub-action"><CalendarCheck2 size={17}/><span><strong>{c(locale,"Leave decisions","İzin kararları")}</strong><small>{c(locale,"Review pending team leave","Bekleyen ekip izinlerini incele")}</small></span><ChevronRight size={14}/></Link> : null}
      {can(ctx,"time:read") ? <Link href="/module/workflows?view=time-attendance" className="manager-hub-action"><Clock3 size={17}/><span><strong>{c(locale,"Time approvals","Zaman onayları")}</strong><small>{c(locale,"Submitted team time entries","Gönderilmiş ekip zaman kayıtları")}</small></span><ChevronRight size={14}/></Link> : null}
      {can(ctx,"performance:read") ? <Link href="/module/performance" className="manager-hub-action"><ClipboardCheck size={17}/><span><strong>{c(locale,"Performance","Performans")}</strong><small>{c(locale,"Reviews, goals and manager action","Değerlendirme, hedef ve yönetici aksiyonu")}</small></span><ChevronRight size={14}/></Link> : null}
      {can(ctx,"recruiting:read") ? <Link href="/module/recruiting" className="manager-hub-action"><UsersRound size={17}/><span><strong>{c(locale,"Hiring","İşe alım")}</strong><small>{c(locale,"Recruiting work in your scope","Kapsamınızdaki işe alım işleri")}</small></span><ChevronRight size={14}/></Link> : null}
    </section>

    <section className="card enterprise-table-card manager-hub-team">
      <div className="table-title"><div><h3>{c(locale,"Team attention","Ekip dikkati")}</h3><p>{c(locale,"Direct reports only. Sensitive domains still enforce their own authorization when opened.","Yalnız doğrudan bağlı çalışanlar. Hassas alanlar açıldığında kendi yetkilendirmelerini uygulamaya devam eder.")}</p></div><span>{data.attentionPeople} {c(locale,"need attention","dikkat gerektiriyor")}</span></div>
      <div className="table-wrap"><table className="enterprise-table"><thead><tr><th>{c(locale,"Employee","Çalışan")}</th><th>{c(locale,"Position","Pozisyon")}</th><th>{c(locale,"Leave","İzin")}</th><th>{c(locale,"Time","Zaman")}</th><th>{c(locale,"Review","Değerlendirme")}</th><th>{c(locale,"Goals","Hedefler")}</th><th>{c(locale,"Learning","Eğitim")}</th><th>{c(locale,"Open","Aç")}</th></tr></thead><tbody>
        {data.rows.length ? data.rows.map((row) => <tr key={row.id} className={row.attention ? "manager-attention-row" : undefined}>
          <td><strong className="cell-strong">{row.name}</strong><small className="cell-sub">{row.employeeNumber} · {row.email}</small></td>
          <td>{row.position}<small className="cell-sub">{row.organization}{row.criticalPosition ? c(locale," · Critical"," · Kritik") : ""}</small></td>
          <td>{row.pendingLeave || "—"}</td><td>{row.pendingTime || "—"}</td><td>{row.managerReviews || "—"}</td><td>{row.goalsAtRisk || "—"}</td><td>{row.learningDue || "—"}</td>
          <td><Link className="secondary-button compact" href={`/module/employee-360?person=${encodeURIComponent(row.personId)}`}>{c(locale,"View","Görüntüle")}<ChevronRight size={13}/></Link></td>
        </tr>) : <tr><td colSpan={8} className="workflow-action-empty">{c(locale,"No active direct reports are linked to this manager employment.","Bu yönetici istihdamına bağlı aktif doğrudan çalışan bulunmuyor.")}</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}
