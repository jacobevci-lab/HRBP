import Link from "next/link";
import { BookOpenCheck, CalendarDays, ChevronRight, ClipboardCheck, FileText, Goal, GraduationCap, HandCoins, HelpCircle, ShieldCheck, UserRound } from "lucide-react";
import { getEmployeeHomeData } from "@/lib/employee-home-data";
import { getServerLocale } from "@/lib/i18n-server";
import { getServerRequestContext } from "@/lib/server-session";

function c(locale: "en" | "tr", en: string, tr: string) { return locale === "tr" ? tr : en; }
function date(value: Date, locale: "en" | "tr") {
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { dateStyle: "medium", timeZone: "Europe/Istanbul" }).format(value);
}

export async function EmployeeHome() {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx) return <section className="card manager-hub-restricted"><ShieldCheck size={24}/><div><h3>{c(locale,"Authentication required","Kimlik doğrulama gerekli")}</h3><p>{c(locale,"Employee Home uses your signed employment identity.","Çalışan Ana Sayfası imzalı istihdam kimliğinizi kullanır.")}</p></div></section>;

  const data = await getEmployeeHomeData(ctx);
  if (!data) return <section className="card manager-hub-restricted"><ShieldCheck size={24}/><div><h3>{c(locale,"Employee Home is unavailable","Çalışan Ana Sayfası kullanılamıyor")}</h3><p>{c(locale,"A valid employee role and employment identity are required.","Geçerli çalışan rolü ve istihdam kimliği gereklidir.")}</p></div></section>;

  const quick = [
    { href:"/module/workflows", icon:<ClipboardCheck size={17}/>, title:c(locale,"My Work","İşlerim"), detail:c(locale,"Tasks, approvals and actions","Görevler, onaylar ve aksiyonlar") },
    { href:"/module/leave", icon:<CalendarDays size={17}/>, title:c(locale,"Leave","İzin"), detail:c(locale,`${data.pendingLeave} pending request(s)`,`${data.pendingLeave} bekleyen talep`) },
    { href:"/module/payroll", icon:<HandCoins size={17}/>, title:c(locale,"Payslips","Bordrolarım"), detail:c(locale,"Open audited payroll self-service","Denetimli bordro self-servisini aç") },
    { href:"/module/documents", icon:<FileText size={17}/>, title:c(locale,"Documents","Dokümanlar"), detail:c(locale,"Private employee documents","Özel çalışan dokümanları") },
    { href:"/module/performance", icon:<Goal size={17}/>, title:c(locale,"Goals & performance","Hedef & performans"), detail:c(locale,`${data.selfReviews} self-review(s) · ${data.activeGoals} active goal(s)`,`${data.selfReviews} öz değerlendirme · ${data.activeGoals} aktif hedef`) },
    { href:"/module/learning", icon:<GraduationCap size={17}/>, title:c(locale,"Learning","Eğitim"), detail:c(locale,`${data.learningAttention} overdue assignment(s)`,`${data.learningAttention} gecikmiş atama`) },
    { href:"/module/hr-service", icon:<HelpCircle size={17}/>, title:c(locale,"HR Service","İK Hizmetleri"), detail:c(locale,`${data.serviceOpen} open request(s)`,`${data.serviceOpen} açık talep`) },
    { href:"/module/policies", icon:<BookOpenCheck size={17}/>, title:c(locale,"Policies","Politikalar"), detail:c(locale,`${data.policiesPending} acknowledgement(s) pending`,`${data.policiesPending} bekleyen okuma/onay`) }
  ];

  return <div className="employee-home">
    <section className="employee-home-hero card">
      <div className="employee-home-avatar"><UserRound size={24}/></div>
      <div className="employee-home-identity"><span className="section-kicker">{c(locale,"Employee Home","Çalışan Ana Sayfası")}</span><h1>{c(locale,"Welcome","Hoş geldin")}, {data.employee.name.split(" ")[0]}</h1><p>{data.employee.position} · {data.employee.organization}</p><div className="identity-meta"><span>{data.employee.employeeNumber}</span><span>{data.employee.email}</span>{data.employee.manager ? <span>{c(locale,"Manager","Yönetici")}: {data.employee.manager}</span> : null}</div></div>
      <Link className="secondary-button" href={`/module/employee-360?person=${encodeURIComponent(data.employee.personId)}`}>{c(locale,"My profile","Profilim")}<ChevronRight size={14}/></Link>
    </section>

    <section className="employee-home-grid">
      {quick.map((item) => <Link key={item.href} href={item.href} className="employee-home-action"><span>{item.icon}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><ChevronRight size={14}/></Link>)}
    </section>

    <section className="profile-grid two-column employee-home-lower">
      <div className="card employee-home-panel">
        <div className="table-title"><div><h3>{c(locale,"Leave balance","İzin bakiyesi")}</h3><p>{c(locale,"Current-year governed balances.","Mevcut yıl yönetişimli bakiyeleri.")}</p></div><CalendarDays size={18}/></div>
        <div className="employee-home-balance-list">
          {data.leaveBalances.length ? data.leaveBalances.slice(0,6).map((item) => <div key={item.code}><span><strong>{item.name}</strong><small>{item.code}</small></span><b>{item.available.toLocaleString(locale === "tr" ? "tr-TR" : "en-GB")} {item.unit === "DAYS" ? c(locale,"days","gün") : c(locale,"hours","saat")}</b></div>) : <p>{c(locale,"No leave balance is configured for the current year.","Mevcut yıl için izin bakiyesi tanımlı değil.")}</p>}
        </div>
        {data.nextLeave ? <div className="employee-home-next"><small>{c(locale,"Next approved leave","Sonraki onaylı izin")}</small><strong>{data.nextLeave.leaveType.name}</strong><span>{date(data.nextLeave.startsAt, locale)} → {date(data.nextLeave.endsAt, locale)}</span></div> : null}
      </div>

      <div className="card employee-home-panel">
        <div className="table-title"><div><h3>{c(locale,"Learning attention","Eğitim dikkati")}</h3><p>{c(locale,"Assigned and in-progress learning from your governed development record.","Yönetişimli gelişim kaydınızdaki atanmış ve devam eden eğitimler.")}</p></div><GraduationCap size={18}/></div>
        <div className="employee-home-learning-list">
          {data.learning.length ? data.learning.slice(0,5).map((item) => <Link key={item.id} href="/module/learning"><span><strong>{item.course.title}</strong><small>{item.course.mandatory ? c(locale,"Mandatory","Zorunlu") : c(locale,"Development","Gelişim")}</small></span><em className={`pill ${item.status.toLowerCase().replaceAll("_","-")}`}>{item.status.replaceAll("_"," ")}</em></Link>) : <p>{c(locale,"No active learning assignments.","Aktif eğitim ataması yok.")}</p>}
        </div>
      </div>
    </section>
  </div>;
}
