import Link from "next/link";
import { AlertTriangle, ArrowRight, CircleHelp, DatabaseZap, ShieldCheck, UserMinus, UserPlus, Workflow } from "lucide-react";
import { getHROperationsHubData } from "@/lib/hr-operations-hub-data";
import { getServerLocale } from "@/lib/i18n-server";
import { getServerRequestContext } from "@/lib/server-session";

function c(locale: "en" | "tr", en: string, tr: string) { return locale === "tr" ? tr : en; }
function Metric({ icon, label, value, meta, danger = false }: { icon: React.ReactNode; label: string; value: string; meta: string; danger?: boolean }) {
  return <div className={`enterprise-stat ${danger ? "operations-stat-danger" : ""}`}><div className="enterprise-stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

export async function HROperationsHub() {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx) return <section className="card manager-hub-restricted"><ShieldCheck size={24}/><div><h3>{c(locale,"Authentication required","Kimlik doğrulama gerekli")}</h3><p>{c(locale,"HR Operations Hub uses live tenant operational data.","İK Operasyon Merkezi canlı tenant operasyon verisini kullanır.")}</p></div></section>;
  const data = await getHROperationsHubData(ctx);
  if (!data) return <section className="card manager-hub-restricted"><ShieldCheck size={24}/><div><h3>{c(locale,"HR Operations Hub is role scoped","İK Operasyon Merkezi rol kapsamlıdır")}</h3><p>{c(locale,"This workspace is available to HR Operations roles only.","Bu çalışma alanı yalnız HR Operations rolleri için kullanılabilir.")}</p></div></section>;

  const attention = [
    { key:"onboarding", count:data.onboardingBlocked + data.onboardingOverdue, title:c(locale,"Onboarding blockers","İşe başlatma blokajları"), detail:c(locale,`${data.onboardingBlocked} blocked · ${data.onboardingOverdue} overdue`,`${data.onboardingBlocked} blokeli · ${data.onboardingOverdue} gecikmiş`), href:"/module/onboarding", tone:"danger" },
    { key:"offboarding", count:data.separationBlocked, title:c(locale,"Offboarding blockers","İşten ayrılış blokajları"), detail:c(locale,`${data.separationOpen} active separation processes`,`${data.separationOpen} aktif ayrılış süreci`), href:"/module/offboarding", tone:"danger" },
    { key:"service", count:data.serviceBreached + data.serviceCritical, title:c(locale,"HR Service attention","İK Hizmet dikkati"), detail:c(locale,`${data.serviceBreached} SLA breaches · ${data.serviceCritical} critical`,`${data.serviceBreached} SLA ihlali · ${data.serviceCritical} kritik`), href:"/module/hr-service", tone:"warning" },
    { key:"lifecycle", count:data.scheduledBlocked, title:c(locale,"Lifecycle changes blocked","Yaşam döngüsü değişiklikleri blokeli"), detail:c(locale,"Scheduled position changes need intervention","Planlı pozisyon değişiklikleri müdahale bekliyor"), href:"/module/people", tone:"warning" },
    { key:"position", count:data.missingPosition, title:c(locale,"Missing position assignment","Pozisyon ataması eksik"), detail:c(locale,"Active employments without a governed position","Yönetişimli pozisyonu olmayan aktif istihdam"), href:"/module/people", tone:"neutral" },
    { key:"email", count:data.missingWorkEmail, title:c(locale,"Missing work email","İş e-postası eksik"), detail:c(locale,"Active workforce records needing data completion","Veri tamamlama gereken aktif çalışan kayıtları"), href:"/module/people", tone:"neutral" }
  ].sort((a,b)=>b.count-a.count);

  return <div className="operations-hub">
    <section className="page-heading module-heading manager-hub-heading">
      <div><div className="eyebrow">HRBP One / {c(locale,"HR Operations","İK Operasyonları")}</div><h1>{c(locale,"Operations Hub","Operasyon Merkezi")}</h1><p>{c(locale,"Run the employee lifecycle from operational attention, blockers and data quality — not by opening every module one by one.","Çalışan yaşam döngüsünü her modülü tek tek açmak yerine operasyonel dikkat, blokaj ve veri kalitesi üzerinden yönetin.")}</p></div>
      <div className="module-heading-actions"><Link className="create-button" href="/module/workflows">{c(locale,"Open My Work","İşlerimi aç")}<ArrowRight size={15}/></Link></div>
    </section>

    <section className="enterprise-stats manager-hub-stats">
      <Metric icon={<UserPlus size={17}/>} label={c(locale,"Active onboarding","Aktif işe başlatma")} value={String(data.onboardingOpen)} meta={c(locale,`${data.upcomingStarters} start within 14 days`,`14 gün içinde ${data.upcomingStarters} başlangıç`)}/>
      <Metric icon={<UserMinus size={17}/>} label={c(locale,"Active offboarding","Aktif işten ayrılış")} value={String(data.separationOpen)} meta={c(locale,`${data.separationBlocked} blocking tasks`,`${data.separationBlocked} bloklayıcı görev`)} danger={data.separationBlocked > 0}/>
      <Metric icon={<CircleHelp size={17}/>} label={c(locale,"Open HR service","Açık İK hizmeti")} value={String(data.serviceOpen)} meta={c(locale,`${data.serviceBreached} SLA breaches`,`${data.serviceBreached} SLA ihlali`)} danger={data.serviceBreached > 0}/>
      <Metric icon={<AlertTriangle size={17}/>} label={c(locale,"Operational attention","Operasyonel dikkat")} value={String(data.totalOperationalAttention)} meta={c(locale,"Cross-domain blockers & data issues","Domainler arası blokaj ve veri sorunları")} danger={data.totalOperationalAttention > 0}/>
    </section>

    <section className="operations-attention-grid">
      {attention.map((item) => <Link key={item.key} href={item.href} className={`operations-attention-card ${item.tone}`}>
        <span className="operations-attention-count">{item.count}</span>
        <span><strong>{item.title}</strong><small>{item.detail}</small></span>
        <ArrowRight size={15}/>
      </Link>)}
    </section>

    <section className="profile-grid two-column operations-lanes">
      <div className="card operations-lane">
        <div className="table-title"><div><h3>{c(locale,"Lifecycle operations","Yaşam döngüsü operasyonları")}</h3><p>{c(locale,"Move from employee event to completion with blockers visible.","Çalışan olayından tamamlanmaya blokajlar görünür şekilde ilerleyin.")}</p></div><Workflow size={18}/></div>
        <Link href="/module/onboarding"><span>{c(locale,"Onboarding","İşe başlatma")}</span><strong>{data.onboardingOpen}</strong><small>{data.onboardingBlocked} {c(locale,"blocked","blokeli")} · {data.onboardingOverdue} {c(locale,"overdue","gecikmiş")}</small><ArrowRight size={14}/></Link>
        <Link href="/module/offboarding"><span>{c(locale,"Offboarding","İşten ayrılış")}</span><strong>{data.separationOpen}</strong><small>{data.separationBlocked} {c(locale,"blocking tasks","bloklayıcı görev")}</small><ArrowRight size={14}/></Link>
        <Link href="/module/people"><span>{c(locale,"Scheduled changes","Planlı değişiklikler")}</span><strong>{data.scheduledBlocked}</strong><small>{c(locale,"blocked position/lifecycle changes","blokeli pozisyon/yaşam döngüsü değişikliği")}</small><ArrowRight size={14}/></Link>
      </div>
      <div className="card operations-lane">
        <div className="table-title"><div><h3>{c(locale,"Data quality","Veri kalitesi")}</h3><p>{c(locale,"Fix operational master-data gaps before they cascade into payroll, access or reporting.","Operasyonel ana veri eksiklerini bordro, erişim veya raporlamaya yansımadan düzeltin.")}</p></div><DatabaseZap size={18}/></div>
        <Link href="/module/people"><span>{c(locale,"Missing position","Pozisyon eksik")}</span><strong>{data.missingPosition}</strong><small>{c(locale,"active employments","aktif istihdam")}</small><ArrowRight size={14}/></Link>
        <Link href="/module/people"><span>{c(locale,"Missing work email","İş e-postası eksik")}</span><strong>{data.missingWorkEmail}</strong><small>{c(locale,"active workforce records","aktif çalışan kaydı")}</small><ArrowRight size={14}/></Link>
        <Link href="/module/hr-service"><span>{c(locale,"Service SLA breaches","Hizmet SLA ihlalleri")}</span><strong>{data.serviceBreached}</strong><small>{data.serviceCritical} {c(locale,"critical requests","kritik talep")}</small><ArrowRight size={14}/></Link>
      </div>
    </section>
  </div>;
}
