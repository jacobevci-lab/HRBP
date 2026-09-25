import { BadgeCheck, BriefcaseBusiness, CalendarClock, CircleAlert, FileCheck2, LockKeyhole, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { can } from "@/lib/authorization";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";
import { getServerRequestContext } from "@/lib/server-session";
import { getOnboardingWorkspaceData, getRecruitingWorkspaceData } from "@/lib/recruiting-live-data";
import { getRecruitingOperationsData } from "@/lib/recruiting-operations-data";
import { getOnboardingOperationsData } from "@/lib/onboarding-operations-data";
import { onboardingPeople, onboardingTasks, pipeline, requisitions } from "@/lib/recruiting-demo";
import { RecruitingOperationsConsole } from "@/components/recruiting-operations-console";
import { OnboardingOperationsConsole } from "@/components/onboarding-operations-console";

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }

function localStatus(locale: Locale, value: string) {
  if (locale !== "tr") return value;
  const labels: Record<string,string> = {
    DRAFT:"Taslak", APPROVAL:"Onay", OPEN:"Açık", ON_HOLD:"Beklemede", CLOSED:"Kapalı", CANCELLED:"İptal",
    APPLIED:"Başvurdu", SCREENING:"Ön Eleme", INTERVIEW:"Mülakat", ASSESSMENT:"Değerlendirme", OFFER:"Teklif", HIRED:"İşe Alındı", REJECTED:"Reddedildi", WITHDRAWN:"Geri Çekildi",
    SENT:"Gönderildi", ACCEPTED:"Kabul Edildi", DECLINED:"Reddedildi", EXPIRED:"Süresi Doldu",
    Active:"Aktif", Review:"İncelemede", Healthy:"Sağlıklı", Blocked:"Engelli", Pending:"Bekliyor", Approved:"Onaylandı"
  };
  return labels[value] ?? labels[value.toUpperCase()] ?? value;
}

function Metric({ label, value, note, icon: Icon }: { label:string; value:string; note:string; icon:React.ComponentType<{size?:number}> }) {
  return <div className="recruit-metric"><span><Icon size={16}/></span><div><small>{label}</small><strong>{value}</strong><em>{note}</em></div></div>;
}

function RestrictedNotice({ domain, locale }: { domain: string; locale: Locale }) {
  return <div className="card employee-restricted-card" style={{ marginBottom: 14 }}><LockKeyhole size={22}/><div><h3>{c(locale,`${domain} data is protected`,`${domain} verisi korumalıdır`)}</h3><p>{c(locale,"The public staging experience uses synthetic records. Sign in with an authorized enterprise role to load restricted live records from PostgreSQL.","Genel staging deneyimi sentetik kayıtlar kullanır. PostgreSQL'deki kısıtlı canlı kayıtları yüklemek için yetkili kurumsal rolle giriş yapın.")}</p></div></div>;
}

function DemoRecruiting({ locale }: { locale: Locale }) {
  return <>
    <RestrictedNotice domain={c(locale,"Recruiting","İşe Alım")} locale={locale}/>
    <div className="recruit-metrics"><Metric label={c(locale,"Open requisitions","Açık talepler")} value="12" note={c(locale,"Synthetic staging data","Sentetik staging verisi")} icon={BriefcaseBusiness}/><Metric label={c(locale,"Active candidates","Aktif adaylar")} value="86" note={c(locale,"Synthetic staging data","Sentetik staging verisi")} icon={UsersRound}/><Metric label={c(locale,"Interview pipeline","Mülakat havuzu")} value="18" note={c(locale,"Synthetic staging data","Sentetik staging verisi")} icon={CalendarClock}/><Metric label={c(locale,"Offers","Teklifler")} value="6" note={c(locale,"Synthetic staging data","Sentetik staging verisi")} icon={FileCheck2}/></div>
    <div className="recruit-grid"><section className="card pipeline-card"><div className="recruit-title"><div><h3>{c(locale,"Candidate pipeline","Aday havuzu")}</h3><p>{c(locale,"Synthetic preview — live candidate identities require recruiting:read.","Sentetik önizleme — canlı aday kimlikleri recruiting:read yetkisi gerektirir.")}</p></div><span>{c(locale,"Demo","Demo")}</span></div><div className="pipeline-board">{pipeline.map((column)=><div className="pipeline-column" key={column.stage}><header><strong>{localStatus(locale,column.stage)}</strong><span>{column.count}</span></header>{column.people.map((person,i)=><article key={person}><div className="candidate-avatar">{person.split(" ").map(n=>n[0]).join("")}</div><div><strong>{person}</strong><small>{i === 0 ? c(locale,"Senior profile","Kıdemli profil") : c(locale,"Candidate record","Aday kaydı")}</small></div><em>{i === 0 ? "2d" : "4d"}</em></article>)}<button disabled>{c(locale,"Protected live records","Korumalı canlı kayıtlar")}</button></div>)}</div></section>
    <section className="card requisition-card"><div className="recruit-title"><div><h3>{c(locale,"Requisitions","İşe alım talepleri")}</h3><p>{c(locale,"Synthetic position-backed hiring demand","Pozisyon destekli sentetik işe alım ihtiyacı")}</p></div><button className="secondary-button" disabled>{c(locale,"Approval queue","Onay kuyruğu")}</button></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>{c(locale,"Requisition","Talep")}</th><th>{c(locale,"Org / location","Org / lokasyon")}</th><th>{c(locale,"Hiring manager","İşe alım yöneticisi")}</th><th>{c(locale,"Recruiter","İşe alım uzmanı")}</th><th>{c(locale,"Candidates","Adaylar")}</th><th>{c(locale,"Status","Durum")}</th><th>{c(locale,"Target","Hedef")}</th></tr></thead><tbody>{requisitions.map(r=><tr key={r.id}><td><strong className="cell-strong">{r.title}</strong><small className="cell-sub">{r.id}</small></td><td><strong className="cell-strong">{r.org}</strong><small className="cell-sub">{r.location}</small></td><td>{r.manager}</td><td>{r.recruiter}</td><td>{r.candidates}</td><td><em className={`pill ${r.status.toLowerCase()}`}>{localStatus(locale,r.status)}</em></td><td>{r.target}</td></tr>)}</tbody></table></div></section></div>
  </>;
}

function DemoOnboarding({ locale }: { locale: Locale }) {
  return <>
    <RestrictedNotice domain={c(locale,"Onboarding","İşe Başlatma")} locale={locale}/>
    <div className="recruit-metrics"><Metric label={c(locale,"Preboarding","İşe başlama öncesi")} value="8" note={c(locale,"Synthetic staging data","Sentetik staging verisi")} icon={UserPlus}/><Metric label={c(locale,"Tasks complete","Tamamlanan görevler")} value="74%" note={c(locale,"Synthetic staging data","Sentetik staging verisi")} icon={BadgeCheck}/><Metric label={c(locale,"Blockers","Engeller")} value="3" note={c(locale,"Synthetic staging data","Sentetik staging verisi")} icon={CircleAlert}/><Metric label={c(locale,"Start readiness","Başlangıç hazırlığı")} value="91%" note={c(locale,"Synthetic staging data","Sentetik staging verisi")} icon={ShieldCheck}/></div>
    <div className="onboarding-grid"><section className="card"><div className="recruit-title"><div><h3>{c(locale,"Onboarding journeys","İşe başlatma yolculukları")}</h3><p>{c(locale,"Synthetic hire-to-day-one orchestration preview.","İşe alımdan ilk güne sentetik orkestrasyon önizlemesi.")}</p></div><button className="secondary-button" disabled>{c(locale,"Journey templates","Yolculuk şablonları")}</button></div><div className="journey-list">{onboardingPeople.map(p=><article key={p.name}><div className="journey-avatar">{p.initials}</div><div className="journey-person"><strong>{p.name}</strong><small>{p.role} · {c(locale,"Starts","Başlangıç")} {p.start}</small></div><div className="journey-owner"><small>{c(locale,"Owner","Sorumlu")}</small><strong>{p.owner}</strong></div><div className="journey-progress"><span><i style={{width:`${p.progress}%`}}/></span><small>{p.progress}% {c(locale,"ready","hazır")}</small></div><em className={p.blockers ? "journey-blocked" : "journey-healthy"}>{p.blockers ? `${p.blockers} ${c(locale,p.blockers>1?"blockers":"blocker","engel")}` : c(locale,"On track","Plana uygun")}</em></article>)}</div></section><section className="card"><div className="recruit-title"><div><h3>{c(locale,"Cross-functional controls","Fonksiyonlar arası kontroller")}</h3><p>{c(locale,"Synthetic enterprise onboarding template","Sentetik kurumsal işe başlatma şablonu")}</p></div></div><div className="task-control-list">{onboardingTasks.map(t=><div key={t.task}><span className={t.risk === "Healthy" ? "task-ok" : "task-watch"}/><div><strong>{t.task}</strong><small>{t.owner} · {c(locale,"Due","Son tarih")} {t.due}</small></div><b>{t.completion}</b></div>)}</div></section></div>
  </>;
}

export async function RecruitingWorkspace({ slug }: { slug:string }) {
  const locale = await getServerLocale();
  const ctx = await getServerRequestContext();

  if (slug === "recruiting") {
    if (!ctx || !can(ctx, "recruiting:read")) return <DemoRecruiting locale={locale}/>;
    try {
      const [data, operations] = await Promise.all([
        getRecruitingWorkspaceData(ctx),
        can(ctx, "recruiting:write") ? getRecruitingOperationsData(ctx.tenantId) : Promise.resolve(null)
      ]);
      return <>
        <div className="recruit-metrics"><Metric label={c(locale,"Open requisitions","Açık talepler")} value={String(data.openRequisitions)} note={c(locale,`${data.approvalRequisitions} awaiting approval`,`${data.approvalRequisitions} onay bekliyor`)} icon={BriefcaseBusiness}/><Metric label={c(locale,"Active candidates","Aktif adaylar")} value={String(data.activeCandidates)} note={c(locale,"Across authorized requisitions","Yetkili işe alım taleplerinde")} icon={UsersRound}/><Metric label={c(locale,"Interview pipeline","Mülakat havuzu")} value={String(data.interviewPipeline)} note={c(locale,"Interview + assessment","Mülakat + değerlendirme")} icon={CalendarClock}/><Metric label={c(locale,"Offers","Teklifler")} value={String(data.activeOffers)} note={c(locale,`${data.awaitingSignature} awaiting response`,`${data.awaitingSignature} yanıt bekliyor`)} icon={FileCheck2}/></div>
        {operations ? <RecruitingOperationsConsole positions={operations.positions} users={operations.users} requisitions={operations.requisitions} applications={operations.applications}/> : null}
        <div className="recruit-grid"><section className="card pipeline-card"><div className="recruit-title"><div><h3>{c(locale,"Candidate pipeline","Aday havuzu")}</h3><p>{c(locale,"Restricted candidate records are limited to authorized requisitions.","Kısıtlı aday kayıtları yalnızca yetkili işe alım talepleriyle sınırlandırılır.")}</p></div><span>{c(locale,"Live PostgreSQL","Canlı PostgreSQL")}</span></div><div className="pipeline-board">{data.pipeline.map((column)=><div className="pipeline-column" key={column.rawStage}><header><strong>{localStatus(locale,column.rawStage) || column.stage}</strong><span>{column.count}</span></header>{column.people.length ? column.people.map((person)=><article key={person.id}><div className="candidate-avatar">{person.name.split(" ").map(n=>n[0]).slice(0,2).join("")}</div><div><strong>{person.name}</strong><small>{person.requisition}</small></div><em>{person.appliedAt}</em></article>) : <article><div><strong>{c(locale,"No records","Kayıt yok")}</strong><small>{c(locale,"Stage is currently empty","Bu aşama şu anda boş")}</small></div></article>}<button disabled>{column.count} {c(locale,"total records","toplam kayıt")}</button></div>)}</div></section>
        <section className="card requisition-card"><div className="recruit-title"><div><h3>{c(locale,"Requisitions","İşe alım talepleri")}</h3><p>{c(locale,"Live position-backed hiring demand","Canlı pozisyon destekli işe alım ihtiyacı")}</p></div><button className="secondary-button" disabled>{c(locale,"Approval queue","Onay kuyruğu")}</button></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>{c(locale,"Requisition","Talep")}</th><th>{c(locale,"Org / location","Org / lokasyon")}</th><th>{c(locale,"Hiring manager","İşe alım yöneticisi")}</th><th>{c(locale,"Recruiter","İşe alım uzmanı")}</th><th>{c(locale,"Candidates","Adaylar")}</th><th>{c(locale,"Status","Durum")}</th><th>{c(locale,"Target","Hedef")}</th></tr></thead><tbody>{data.requisitions.length ? data.requisitions.map(r=><tr key={r.id}><td><strong className="cell-strong">{r.title}</strong><small className="cell-sub">{r.id}</small></td><td><strong className="cell-strong">{r.org}</strong><small className="cell-sub">{r.location}</small></td><td>{r.hiringManager}</td><td>{r.recruiter}</td><td>{r.candidates}</td><td><em className={`pill ${r.status.toLowerCase().replaceAll(" ", "-")}`}>{localStatus(locale,r.status)}</em></td><td>{r.target}</td></tr>) : <tr><td colSpan={7} style={{ textAlign:"center", padding:28 }}>{c(locale,"No requisitions are visible in your hiring scope.","İşe alım kapsamınızda görünür talep yok.")}</td></tr>}</tbody></table></div></section></div>
        <div className="privacy-strip"><ShieldCheck size={17}/><div><strong>{c(locale,"Recruiting privacy boundary","İşe alım gizlilik sınırı")}</strong><p>{c(locale,"Managers see candidate records only for requisitions they own. Recruiting writers retain tenant recruiting operations authority; candidate records remain Restricted until a controlled Hire transition.","Yöneticiler aday kayıtlarını yalnızca sorumlusu oldukları işe alım taleplerinde görür. İşe alım yazma yetkilileri tenant operasyon yetkisini korur; aday kayıtları kontrollü İşe Al geçişine kadar Kısıtlı kalır.")}</p></div><span>{c(locale,"Policy enforced","Politika uygulanıyor")}</span></div>
      </>;
    } catch (error) {
      console.error("[HRBP] Recruiting live data failed", error);
      return <DemoRecruiting locale={locale}/>;
    }
  }

  if (slug === "onboarding") {
    if (!ctx || !can(ctx, "onboarding:read")) return <DemoOnboarding locale={locale}/>;
    try {
      const [data, operations] = await Promise.all([
        getOnboardingWorkspaceData(ctx),
        can(ctx, "onboarding:write") ? getOnboardingOperationsData(ctx) : Promise.resolve(null)
      ]);
      return <>
        <div className="recruit-metrics"><Metric label={c(locale,"Active journeys","Aktif yolculuklar")} value={String(data.preboarding)} note={c(locale,"Authorized onboarding plans","Yetkili işe başlatma planları")} icon={UserPlus}/><Metric label={c(locale,"Tasks complete","Tamamlanan görevler")} value={`${data.taskCompletion}%`} note={c(locale,"Across visible plans","Görünür planlar genelinde")} icon={BadgeCheck}/><Metric label={c(locale,"Blockers","Engeller")} value={String(data.blockers)} note={c(locale,"Blocked onboarding tasks","Engelli işe başlatma görevleri")} icon={CircleAlert}/><Metric label={c(locale,"Start readiness","Başlangıç hazırlığı")} value={`${data.readiness}%`} note={c(locale,"Average visible journey readiness","Ortalama görünür yolculuk hazırlığı")} icon={ShieldCheck}/></div>
        {operations ? <OnboardingOperationsConsole tasks={operations}/> : null}
        <div className="onboarding-grid"><section className="card"><div className="recruit-title"><div><h3>{c(locale,"Onboarding journeys","İşe başlatma yolculukları")}</h3><p>{c(locale,"Relationship-scoped hire-to-day-one orchestration across People, IT and managers.","Çalışanlar, IT ve yöneticiler arasında ilişki kapsamlı işe alımdan ilk güne orkestrasyon.")}</p></div><button className="secondary-button" disabled>{c(locale,"Journey templates","Yolculuk şablonları")}</button></div><div className="journey-list">{data.journeys.length ? data.journeys.map(p=><article key={p.id}><div className="journey-avatar">{p.initials}</div><div className="journey-person"><strong>{p.name}</strong><small>{p.role} · {c(locale,"Starts","Başlangıç")} {p.start}</small></div><div className="journey-owner"><small>{c(locale,"Owner","Sorumlu")}</small><strong>{p.owner}</strong></div><div className="journey-progress"><span><i style={{width:`${p.progress}%`}}/></span><small>{p.progress}% {c(locale,"ready","hazır")}</small></div><em className={p.blockers ? "journey-blocked" : "journey-healthy"}>{p.blockers ? `${p.blockers} ${c(locale,p.blockers>1?"blockers":"blocker","engel")}` : localStatus(locale,p.status)}</em></article>) : <div style={{ padding:24 }}>{c(locale,"No onboarding journeys are visible in your employment scope.","İstihdam kapsamınızda görünür işe başlatma yolculuğu yok.")}</div>}</div></section><section className="card"><div className="recruit-title"><div><h3>{c(locale,"Cross-functional controls","Fonksiyonlar arası kontroller")}</h3><p>{c(locale,"Grouped from authorized onboarding tasks","Yetkili işe başlatma görevlerinden gruplandı")}</p></div></div><div className="task-control-list">{data.controls.length ? data.controls.map(t=><div key={t.title}><span className={t.risk === "Healthy" ? "task-ok" : "task-watch"}/><div><strong>{t.title}</strong><small>{t.owner} · {c(locale,"Due","Son tarih")} {t.due}</small></div><b>{t.completion}</b></div>) : <div style={{ padding:20 }}>{c(locale,"No task controls are visible in your scope.","Kapsamınızda görünür görev kontrolü yok.")}</div>}</div><div className="onboarding-policy"><ShieldCheck size={17}/><p>{c(locale,"Sensitive identity documents remain in the restricted vault. Onboarding journeys and operational tasks are filtered by the same employment population policy used by the onboarding APIs.","Hassas kimlik dokümanları kısıtlı kasada kalır. İşe başlatma yolculukları ve operasyon görevleri, onboarding API'leriyle aynı istihdam nüfusu politikasıyla filtrelenir.")}</p></div></section></div>
      </>;
    } catch (error) {
      console.error("[HRBP] Onboarding live data failed", error);
      return <DemoOnboarding locale={locale}/>;
    }
  }
  return null;
}

export const recruitingWorkspaceSlugs = new Set(["recruiting","onboarding"]);
