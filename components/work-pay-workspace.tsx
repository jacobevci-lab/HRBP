import { AlertTriangle, BadgeDollarSign, CalendarCheck2, CheckCircle2, Clock3, Globe2, LockKeyhole, MoreHorizontal, ReceiptText, ShieldCheck, TimerReset, TrendingUp, UsersRound } from "lucide-react";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";

export const workPayWorkspaceSlugs = new Set(["time-attendance", "leave", "compensation", "payroll"]);

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }

function statusLabel(locale: Locale, value: string) {
  if (locale !== "tr") return value;
  const labels: Record<string, string> = {
    Approved: "Onaylandı",
    Review: "İncelemede",
    "Missing exit": "Çıkış eksik",
    Pending: "Bekliyor",
    Ready: "Hazır",
    Validation: "Doğrulama"
  };
  return labels[value] ?? value;
}

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="workpay-metric card"><div className="workpay-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function Status({ value, locale }: { value: string; locale: Locale }) {
  const key = value.toLowerCase().replace(/\s+/g, "-");
  return <em className={`workpay-status ${key}`}>{statusLabel(locale, value)}</em>;
}

function TimeWorkspace({ locale }: { locale: Locale }) {
  const timeRows = [
    ["Elif Kaya", c(locale,"Engineering","Mühendislik"), "09:02", "18:11", "8h 39m", "+9m", "Approved"],
    ["Mert Arslan", c(locale,"Security","Güvenlik"), "08:47", "18:24", "9h 07m", "+37m", "Review"],
    ["Derya Aksoy", c(locale,"Finance","Finans"), "09:12", "—", "6h 14m", "—", "Missing exit"],
    ["Can Demir", c(locale,"Operations","Operasyon"), "08:55", "17:58", "8h 33m", "+3m", "Approved"]
  ];
  return <>
    <section className="workpay-metrics">
      <Metric icon={<UsersRound size={18}/>} label={c(locale,"Expected today","Bugün beklenen")} value="497" meta={c(locale,"95.6% of active workforce","Aktif iş gücünün %95,6'sı")}/>
      <Metric icon={<Clock3 size={18}/>} label={c(locale,"Clocked in","Giriş yapan")} value="472" meta={c(locale,"25 not yet recorded","25 kayıt henüz oluşmadı")}/>
      <Metric icon={<TrendingUp size={18}/>} label={c(locale,"Overtime today","Bugünkü fazla mesai")} value="31.4h" meta={c(locale,"8 employees above threshold","8 çalışan eşik üzerinde")}/>
      <Metric icon={<AlertTriangle size={18}/>} label={c(locale,"Exceptions","İstisnalar")} value="12" meta={c(locale,"4 require manager action","4 yönetici aksiyonu bekliyor")}/>
    </section>
    <section className="workpay-split">
      <div className="card workpay-panel"><div className="workpay-panel-head"><div><span className="section-kicker">{c(locale,"Daily control","Günlük kontrol")}</span><h3>{c(locale,"Attendance exceptions","Devam istisnaları")}</h3></div><button><MoreHorizontal size={18}/></button></div><div className="workpay-table-wrap"><table className="workpay-table"><thead><tr><th>{c(locale,"Employee","Çalışan")}</th><th>{c(locale,"Department","Departman")}</th><th>{c(locale,"In","Giriş")}</th><th>{c(locale,"Out","Çıkış")}</th><th>{c(locale,"Worked","Çalışılan")}</th><th>{c(locale,"OT","FM")}</th><th>{c(locale,"Status","Durum")}</th></tr></thead><tbody>{timeRows.map((r)=><tr key={r[0]}>{r.slice(0,6).map((v,i)=><td key={i}>{v}</td>)}<td><Status value={r[6]} locale={locale}/></td></tr>)}</tbody></table></div></div>
      <aside className="card workpay-side"><div className="workpay-panel-head"><div><span className="section-kicker">{c(locale,"Controls","Kontroller")}</span><h3>{c(locale,"Time governance","Zaman yönetişimi")}</h3></div></div><div className="control-stack"><div><CheckCircle2 size={17}/><span><strong>{c(locale,"Schedule coverage","Plan kapsamı")}</strong><small>{c(locale,"98.7% assigned to an effective schedule","%98,7 geçerli bir plana atanmış")}</small></span></div><div><TimerReset size={17}/><span><strong>{c(locale,"Auto-lock","Otomatik kilit")}</strong><small>{c(locale,"Period locks 3 days after month end","Dönem ay sonundan 3 gün sonra kilitlenir")}</small></span></div><div><ShieldCheck size={17}/><span><strong>{c(locale,"Approval separation","Onay ayrımı")}</strong><small>{c(locale,"Managers approve; payroll consumes locked time","Yöneticiler onaylar; bordro kilitli zamanı kullanır")}</small></span></div></div></aside>
    </section>
  </>;
}

function LeaveWorkspace({ locale }: { locale: Locale }) {
  const leaveRows = [
    ["Selin Yılmaz", c(locale,"Annual leave","Yıllık izin"), "24–27 Sep", c(locale,"4.0 days","4,0 gün"), "Ayşe K.", "Pending"],
    ["Burak Öz", c(locale,"Medical","Sağlık"), "22 Sep", c(locale,"1.0 day","1,0 gün"), c(locale,"Auto","Otomatik"), "Approved"],
    ["Ece Aydın", c(locale,"Annual leave","Yıllık izin"), "06–10 Oct", c(locale,"5.0 days","5,0 gün"), "Kerem T.", "Pending"],
    ["Ozan Şen", c(locale,"Personal","Mazeret"), "30 Sep", c(locale,"0.5 day","0,5 gün"), "Ayşe K.", "Approved"]
  ];
  return <>
    <section className="workpay-metrics">
      <Metric icon={<CalendarCheck2 size={18}/>} label={c(locale,"Pending requests","Bekleyen talepler")} value="18" meta={c(locale,"6 due today","6 tanesi bugün sonuçlanmalı")}/>
      <Metric icon={<UsersRound size={18}/>} label={c(locale,"Away today","Bugün izinli")} value="23" meta={c(locale,"4.4% of workforce","İş gücünün %4,4'ü")}/>
      <Metric icon={<AlertTriangle size={18}/>} label={c(locale,"Coverage conflicts","Kapsama çakışmaları")} value="5" meta={c(locale,"3 teams below threshold","3 ekip eşik altında")}/>
      <Metric icon={<CheckCircle2 size={18}/>} label={c(locale,"SLA compliance","SLA uyumu")} value="96%" meta={c(locale,"30-day approval SLA","30 günlük onay SLA'sı")}/>
    </section>
    <section className="workpay-split">
      <div className="card workpay-panel"><div className="workpay-panel-head"><div><span className="section-kicker">{c(locale,"Requests","Talepler")}</span><h3>{c(locale,"Leave approval queue","İzin onay kuyruğu")}</h3></div><button><MoreHorizontal size={18}/></button></div><div className="workpay-table-wrap"><table className="workpay-table"><thead><tr><th>{c(locale,"Employee","Çalışan")}</th><th>{c(locale,"Type","Tür")}</th><th>{c(locale,"Dates","Tarihler")}</th><th>{c(locale,"Units","Miktar")}</th><th>{c(locale,"Approver","Onaylayan")}</th><th>{c(locale,"Status","Durum")}</th></tr></thead><tbody>{leaveRows.map((r)=><tr key={r[0]}>{r.slice(0,5).map((v,i)=><td key={i}>{v}</td>)}<td><Status value={r[5]} locale={locale}/></td></tr>)}</tbody></table></div></div>
      <aside className="card workpay-side"><div className="workpay-panel-head"><div><span className="section-kicker">{c(locale,"Balance policy","Bakiye politikası")}</span><h3>{c(locale,"2026 annual leave","2026 yıllık izin")}</h3></div></div><div className="balance-ring"><strong>14.8</strong><span>{c(locale,"avg. days remaining","ort. kalan gün")}</span></div><div className="mini-rule"><span>{c(locale,"Accrual engine","Hak ediş motoru")}</span><strong>{c(locale,"Monthly","Aylık")}</strong></div><div className="mini-rule"><span>{c(locale,"Carry-over cap","Devir üst sınırı")}</span><strong>{c(locale,"5 days","5 gün")}</strong></div><div className="mini-rule"><span>{c(locale,"Negative balance","Negatif bakiye")}</span><strong>{c(locale,"Blocked","Engelli")}</strong></div></aside>
    </section>
  </>;
}

function CompensationWorkspace({ locale }: { locale: Locale }) {
  const compRows = [
    [c(locale,"Engineering","Mühendislik"), "184", "₺2.61M", "0.96", "14", "Review"],
    [c(locale,"Sales","Satış"), "128", "₺1.84M", "1.01", "9", "Ready"],
    [c(locale,"Security","Güvenlik"), "29", "₺612K", "1.04", "3", "Review"],
    [c(locale,"Finance","Finans"), "48", "₺721K", "0.99", "2", "Ready"]
  ];
  return <>
    <section className="workpay-metrics">
      <Metric icon={<BadgeDollarSign size={18}/>} label={c(locale,"Annual base payroll","Yıllık baz ücret toplamı")} value="₺67.4M" meta={c(locale,"Current effective records","Geçerli mevcut kayıtlar")}/>
      <Metric icon={<TrendingUp size={18}/>} label={c(locale,"Median increase","Medyan artış")} value="8.6%" meta={c(locale,"Current review cycle","Mevcut değerlendirme döngüsü")}/>
      <Metric icon={<UsersRound size={18}/>} label={c(locale,"In review","İncelemede")} value="28" meta={c(locale,"5 approvals overdue","5 onayın süresi geçti")}/>
      <Metric icon={<ShieldCheck size={18}/>} label={c(locale,"Budget variance","Bütçe sapması")} value="+1.2%" meta={c(locale,"Against approved envelope","Onaylı bütçe zarfına göre")}/>
    </section>
    <section className="workpay-split">
      <div className="card workpay-panel"><div className="workpay-panel-head"><div><span className="section-kicker">{c(locale,"Review cycle","Değerlendirme döngüsü")}</span><h3>{c(locale,"Compensation control center","Ücretlendirme kontrol merkezi")}</h3></div><button><MoreHorizontal size={18}/></button></div><div className="workpay-table-wrap"><table className="workpay-table"><thead><tr><th>{c(locale,"Org","Organizasyon")}</th><th>{c(locale,"Employees","Çalışanlar")}</th><th>{c(locale,"Monthly base","Aylık baz")}</th><th>{c(locale,"Compa ratio","Compa oranı")}</th><th>{c(locale,"Changes","Değişiklikler")}</th><th>{c(locale,"Status","Durum")}</th></tr></thead><tbody>{compRows.map((r)=><tr key={r[0]}>{r.slice(0,5).map((v,i)=><td key={i}>{v}</td>)}<td><Status value={r[5]} locale={locale}/></td></tr>)}</tbody></table></div></div>
      <aside className="card workpay-side restricted-side"><div className="workpay-panel-head"><div><span className="section-kicker">{c(locale,"Restricted domain","Kısıtlı alan")}</span><h3>{c(locale,"Compensation boundary","Ücretlendirme sınırı")}</h3></div><LockKeyhole size={18}/></div><p>{c(locale,"Compensation records are not exposed through broad tenant administration. Access is separated through compensation and payroll roles, purpose-aware audit and restricted exports.","Ücret kayıtları genel tenant yönetimine açılmaz. Erişim; ücret ve bordro rolleri, amaç farkındalıklı denetim ve kısıtlı dışa aktarma kontrolleriyle ayrıştırılır.")}</p><div className="mini-rule"><span>{c(locale,"Four-eyes approval","Dört göz onayı")}</span><strong>{c(locale,"Enabled","Etkin")}</strong></div><div className="mini-rule"><span>{c(locale,"Effective dating","Geçerlilik tarihi")}</span><strong>{c(locale,"Required","Zorunlu")}</strong></div><div className="mini-rule"><span>{c(locale,"Audit on read","Okumada denetim")}</span><strong>{c(locale,"Target","Hedef")}</strong></div></aside>
    </section>
  </>;
}

function PayrollWorkspace({ locale }: { locale: Locale }) {
  const payrollRows = [
    ["TR-2026-09", "Türkiye", c(locale,"Monthly","Aylık"), "520", "₺48.2M", "7", "Validation"],
    ["DE-2026-09", c(locale,"Germany","Almanya"), c(locale,"Monthly","Aylık"), "84", "€612K", "1", "Review"],
    ["NL-2026-09", c(locale,"Netherlands","Hollanda"), c(locale,"Monthly","Aylık"), "41", "€331K", "0", "Approved"]
  ];
  const steps = [
    [c(locale,"Input collection","Girdi toplama"), c(locale,"Completed","Tamamlandı")],
    [c(locale,"Validation","Doğrulama"), c(locale,"Completed","Tamamlandı")],
    [c(locale,"Calculation","Hesaplama"), c(locale,"In progress","Devam ediyor")],
    [c(locale,"Review & sign-off","İnceleme & onay"), c(locale,"Waiting","Bekliyor")],
    [c(locale,"Payment release","Ödeme serbest bırakma"), c(locale,"Waiting","Bekliyor")]
  ];
  return <>
    <section className="workpay-metrics">
      <Metric icon={<ReceiptText size={18}/>} label={c(locale,"Open payrolls","Açık bordrolar")} value="3" meta={c(locale,"625 employees in scope","625 çalışan kapsamda")}/>
      <Metric icon={<AlertTriangle size={18}/>} label={c(locale,"Validation issues","Doğrulama sorunları")} value="8" meta="7 TR · 1 DE"/>
      <Metric icon={<BadgeDollarSign size={18}/>} label={c(locale,"Gross this cycle","Bu döngü brütü")} value="₺48.2M" meta={c(locale,"Türkiye September run","Türkiye Eylül çalışması")}/>
      <Metric icon={<Globe2 size={18}/>} label={c(locale,"Country packs","Ülke paketleri")} value="3" meta={c(locale,"TR · DE · NL active","TR · DE · NL aktif")}/>
    </section>
    <section className="workpay-split">
      <div className="card workpay-panel"><div className="workpay-panel-head"><div><span className="section-kicker">{c(locale,"Payroll operations","Bordro operasyonları")}</span><h3>{c(locale,"Country-pack runs","Ülke paketi çalışmaları")}</h3></div><button><MoreHorizontal size={18}/></button></div><div className="workpay-table-wrap"><table className="workpay-table"><thead><tr><th>{c(locale,"Period","Dönem")}</th><th>{c(locale,"Country","Ülke")}</th><th>{c(locale,"Frequency","Periyot")}</th><th>{c(locale,"Employees","Çalışanlar")}</th><th>{c(locale,"Gross","Brüt")}</th><th>{c(locale,"Issues","Sorunlar")}</th><th>{c(locale,"Status","Durum")}</th></tr></thead><tbody>{payrollRows.map((r)=><tr key={r[0]}>{r.slice(0,6).map((v,i)=><td key={i}>{v}</td>)}<td><Status value={r[6]} locale={locale}/></td></tr>)}</tbody></table></div></div>
      <aside className="card workpay-side payroll-flow"><div className="workpay-panel-head"><div><span className="section-kicker">{c(locale,"Run controls","Çalışma kontrolleri")}</span><h3>{c(locale,"September payroll","Eylül bordrosu")}</h3></div></div>{steps.map(([label,state],i)=><div className="payroll-step" key={label}><span>{i<2?<CheckCircle2 size={15}/>:<Clock3 size={15}/>}</span><div><strong>{label}</strong><small>{state}</small></div></div>)}</aside>
    </section>
  </>;
}

export async function WorkPayWorkspace({ slug }: { slug: string }) {
  const locale = await getServerLocale();
  return <div className="workpay-shell">{slug === "time-attendance" ? <TimeWorkspace locale={locale}/> : slug === "leave" ? <LeaveWorkspace locale={locale}/> : slug === "compensation" ? <CompensationWorkspace locale={locale}/> : <PayrollWorkspace locale={locale}/>}</div>;
}
