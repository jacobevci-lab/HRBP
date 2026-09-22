import { Activity, Award, BookOpenCheck, BrainCircuit, BriefcaseBusiness, CheckCircle2, GraduationCap, HeartHandshake, MoreHorizontal, ShieldCheck, Sparkles, Target, TrendingUp, UsersRound } from "lucide-react";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";

export const growthWorkspaceSlugs = new Set(["benefits", "performance", "talent", "succession", "learning"]);

const benefitRows = [
  ["Private health", "Health", "487", "94%", "₺1.84M", "Active"],
  ["Meal allowance", "Flexible", "512", "99%", "₺842K", "Active"],
  ["Life insurance", "Life", "501", "97%", "₺226K", "Active"],
  ["Pension match", "Retirement", "318", "62%", "₺611K", "Review"]
];
const performanceRows = [
  ["Engineering", "184", "92%", "14", "6", "Calibration"],
  ["Sales", "128", "88%", "18", "9", "Manager review"],
  ["Security", "29", "96%", "3", "2", "Calibration"],
  ["Finance", "48", "94%", "4", "1", "Ready"]
];
const successionRows = [
  ["Head of Platform", "Engineering", "Critical", "2", "1", "Covered"],
  ["Security Architect", "Security", "Critical", "3", "1", "Covered"],
  ["Finance Director", "Finance", "Critical", "1", "0", "Gap"],
  ["Regional Sales Lead", "Sales", "High", "2", "1", "Covered"]
];
const learningRows = [
  ["Secure SDLC", "Security", "Mandatory", "482 / 512", "30 Sep", "94.1%"],
  ["Manager Essentials", "Leadership", "Required", "74 / 81", "15 Oct", "91.4%"],
  ["Privacy & Data Handling", "Compliance", "Mandatory", "501 / 512", "30 Sep", "97.9%"],
  ["Cloud Architecture", "Engineering", "Optional", "66 / 104", "—", "63.5%"]
];
const talentBoxes = [
  ["High potential", "Emerging leaders", "Accelerate", "16", "9", "7"],
  ["Moderate potential", "Core contributors", "Expand", "38", "112", "21"],
  ["Focused growth", "Build consistency", "Develop", "6", "26", "4"]
];

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }
function localized(locale: Locale, value: string) {
  if (locale !== "tr") return value;
  const map: Record<string, string> = {
    "Private health": "Özel sağlık", Health: "Sağlık", "Meal allowance": "Yemek yardımı", Flexible: "Esnek", "Life insurance": "Hayat sigortası", Life: "Hayat", "Pension match": "Emeklilik katkısı", Retirement: "Emeklilik",
    Active: "Aktif", Review: "İncele", Calibration: "Kalibrasyon", "Manager review": "Yönetici incelemesi", Ready: "Hazır", Critical: "Kritik", Covered: "Kapsandı", Gap: "Açık", High: "Yüksek",
    Mandatory: "Zorunlu", Required: "Gerekli", Optional: "İsteğe bağlı", Leadership: "Liderlik", Compliance: "Uyum", Engineering: "Mühendislik", Sales: "Satış", Security: "Güvenlik", Finance: "Finans"
  };
  return map[value] ?? value;
}
function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="growth-metric card"><div className="growth-metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}
function Pill({ value, locale }: { value: string; locale: Locale }) {
  const key = value.toLowerCase().replace(/\s+/g, "-");
  return <em className={`growth-pill ${key}`}>{localized(locale, value)}</em>;
}

function BenefitsWorkspace({ locale }: { locale: Locale }) {
  return <>
    <section className="growth-metrics">
      <Metric icon={<HeartHandshake size={18}/>} label={c(locale,"Eligible employees","Uygun çalışanlar")} value="512" meta={c(locale,"Across 9 active benefit plans","9 aktif yan hak planında")}/>
      <Metric icon={<CheckCircle2 size={18}/>} label={c(locale,"Enrollment complete","Katılım tamamlanma")} value="94.7%" meta={c(locale,"27 actions still open","27 aksiyon hâlâ açık")}/>
      <Metric icon={<TrendingUp size={18}/>} label={c(locale,"Employer monthly cost","İşveren aylık maliyeti")} value="₺3.52M" meta={c(locale,"+2.1% vs approved envelope","Onaylı bütçeye göre +%2,1")}/>
      <Metric icon={<ShieldCheck size={18}/>} label={c(locale,"Coverage exceptions","Kapsam istisnaları")} value="6" meta={c(locale,"Need HR Operations review","İK Operasyon incelemesi gerekiyor")}/>
    </section>
    <section className="growth-split">
      <div className="card growth-panel"><div className="growth-panel-head"><div><span className="section-kicker">{c(locale,"Benefits administration","Yan hak yönetimi")}</span><h3>{c(locale,"Plan coverage & enrollment","Plan kapsamı & katılım")}</h3></div><button><MoreHorizontal size={18}/></button></div><div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>{c(locale,"Plan","Plan")}</th><th>{c(locale,"Type","Tür")}</th><th>{c(locale,"Enrolled","Katılan")}</th><th>{c(locale,"Coverage","Kapsam")}</th><th>{c(locale,"Monthly cost","Aylık maliyet")}</th><th>{c(locale,"Status","Durum")}</th></tr></thead><tbody>{benefitRows.map((r)=><tr key={r[0]}>{r.slice(0,5).map((v,i)=><td key={i}>{localized(locale,v)}</td>)}<td><Pill value={r[5]} locale={locale}/></td></tr>)}</tbody></table></div></div>
      <aside className="card growth-side"><div className="growth-panel-head"><div><span className="section-kicker">{c(locale,"Effective-dated coverage","Geçerlilik tarihli kapsam")}</span><h3>{c(locale,"Governance controls","Yönetişim kontrolleri")}</h3></div></div><div className="growth-control-stack"><div><ShieldCheck size={17}/><span><strong>{c(locale,"Eligibility rules","Uygunluk kuralları")}</strong><small>{c(locale,"Employment, country and plan dates remain authoritative.","İstihdam, ülke ve plan tarihleri yetkili kaynak olarak kalır.")}</small></span></div><div><CheckCircle2 size={17}/><span><strong>{c(locale,"Payroll handoff","Bordro aktarımı")}</strong><small>{c(locale,"Only active, effective enrollments create payroll inputs.","Yalnızca aktif ve geçerli katılımlar bordro girdisi oluşturur.")}</small></span></div><div><Activity size={17}/><span><strong>{c(locale,"History preserved","Geçmiş korunur")}</strong><small>{c(locale,"Coverage changes never overwrite prior elections.","Kapsam değişiklikleri önceki seçimlerin üzerine yazılmaz.")}</small></span></div></div></aside>
    </section>
  </>;
}

function PerformanceWorkspace({ locale }: { locale: Locale }) {
  return <>
    <section className="growth-metrics"><Metric icon={<Target size={18}/>} label={c(locale,"Cycle completion","Döngü tamamlanma")} value="91.8%" meta={c(locale,"2026 annual performance cycle","2026 yıllık performans döngüsü")}/><Metric icon={<Activity size={18}/>} label={c(locale,"Goals at risk","Riskteki hedefler")} value="39" meta={c(locale,"Across 31 employees","31 çalışan genelinde")}/><Metric icon={<UsersRound size={18}/>} label={c(locale,"Calibration queue","Kalibrasyon kuyruğu")} value="41" meta={c(locale,"7 manager groups remaining","7 yönetici grubu kaldı")}/><Metric icon={<CheckCircle2 size={18}/>} label={c(locale,"Reviews finalized","Tamamlanan değerlendirmeler")} value="438" meta={c(locale,"74 still in workflow","74 kayıt iş akışında")}/></section>
    <section className="growth-split"><div className="card growth-panel"><div className="growth-panel-head"><div><span className="section-kicker">{c(locale,"Performance cycle","Performans döngüsü")}</span><h3>{c(locale,"Review operating view","Değerlendirme operasyon görünümü")}</h3></div><button><MoreHorizontal size={18}/></button></div><div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>{c(locale,"Organization","Organizasyon")}</th><th>{c(locale,"People","Çalışanlar")}</th><th>{c(locale,"Complete","Tamamlanma")}</th><th>{c(locale,"At-risk goals","Riskteki hedefler")}</th><th>{c(locale,"Calibration","Kalibrasyon")}</th><th>{c(locale,"Stage","Aşama")}</th></tr></thead><tbody>{performanceRows.map((r)=><tr key={r[0]}>{r.slice(0,5).map((v,i)=><td key={i}>{localized(locale,v)}</td>)}<td><Pill value={r[5]} locale={locale}/></td></tr>)}</tbody></table></div></div><aside className="card growth-side decision-side"><div className="growth-panel-head"><div><span className="section-kicker">{c(locale,"Decision integrity","Karar bütünlüğü")}</span><h3>{c(locale,"Human-owned ratings","İnsan sahipliğinde puanlama")}</h3></div><BrainCircuit size={18}/></div><p>{c(locale,"AI can summarize evidence, highlight missing inputs and surface inconsistencies. Final performance ratings remain assigned and calibrated by authorized people.","AI kanıtları özetleyebilir, eksik girdileri ve tutarsızlıkları gösterebilir. Nihai performans puanları yetkili kişiler tarafından atanır ve kalibre edilir.")}</p><div className="growth-rule"><span>{c(locale,"Automatic rating","Otomatik puanlama")}</span><strong>{c(locale,"Disabled","Kapalı")}</strong></div><div className="growth-rule"><span>{c(locale,"Evidence trace","Kanıt izi")}</span><strong>{c(locale,"Required","Zorunlu")}</strong></div><div className="growth-rule"><span>{c(locale,"Calibration audit","Kalibrasyon denetimi")}</span><strong>{c(locale,"Enabled","Aktif")}</strong></div></aside></section>
  </>;
}

function TalentWorkspace({ locale }: { locale: Locale }) {
  return <><section className="growth-metrics"><Metric icon={<UsersRound size={18}/>} label={c(locale,"People reviewed","Değerlendirilen çalışanlar")} value="486" meta={c(locale,"94.9% cycle coverage","Döngü kapsamı %94,9")}/><Metric icon={<Sparkles size={18}/>} label={c(locale,"High potential","Yüksek potansiyel")} value="32" meta={c(locale,"Human-reviewed designation","İnsan incelemesiyle belirlenir")}/><Metric icon={<Award size={18}/>} label={c(locale,"Critical talent","Kritik yetenek")} value="27" meta={c(locale,"19 with active development plan","19 aktif gelişim planlı")}/><Metric icon={<Activity size={18}/>} label={c(locale,"Calibration actions","Kalibrasyon aksiyonları")} value="14" meta={c(locale,"Due before cycle close","Döngü kapanmadan tamamlanmalı")}/></section><section className="growth-grid"><div className="card talent-matrix"><div className="growth-panel-head"><div><span className="section-kicker">{c(locale,"Human-reviewed talent matrix","İnsan incelemeli yetenek matrisi")}</span><h3>{c(locale,"Performance × potential","Performans × potansiyel")}</h3></div><span className="matrix-note">{c(locale,"Not AI-scored","AI puanı değil")}</span></div><div className="matrix-body">{talentBoxes.map((row)=><div className="matrix-row" key={row[0]}><div className="matrix-label"><strong>{c(locale,row[0],row[0]==="High potential"?"Yüksek potansiyel":row[0]==="Moderate potential"?"Orta potansiyel":"Odaklı gelişim")}</strong><small>{c(locale,row[1],row[1]==="Emerging leaders"?"Gelişen liderler":row[1]==="Core contributors"?"Ana katkı sağlayanlar":"Tutarlılığı geliştir")}</small></div>{row.slice(3).map((value,i)=><div className={`matrix-cell m${i}`} key={i}><strong>{value}</strong><small>{i===0?c(locale,"Develop","Geliştir"):i===1?c(locale,"Sustain","Sürdür"):c(locale,"Accelerate","Hızlandır")}</small></div>)}</div>)}</div><div className="matrix-axis"><span>{c(locale,"Performance →","Performans →")}</span><span>{c(locale,"Needs focus","Odak gerekiyor")}</span><span>{c(locale,"Meets","Karşılıyor")}</span><span>{c(locale,"Exceeds","Aşıyor")}</span></div></div><aside className="card growth-side"><div className="growth-panel-head"><div><span className="section-kicker">{c(locale,"Governance","Yönetişim")}</span><h3>{c(locale,"Talent decision controls","Yetenek karar kontrolleri")}</h3></div></div><div className="growth-control-stack"><div><ShieldCheck size={17}/><span><strong>{c(locale,"No hidden employee score","Gizli çalışan skoru yok")}</strong><small>{c(locale,"Assessments retain the human assessor and review cycle.","Değerlendirmelerde insan değerlendirici ve inceleme döngüsü korunur.")}</small></span></div><div><BrainCircuit size={17}/><span><strong>{c(locale,"AI supports evidence","AI kanıtı destekler")}</strong><small>{c(locale,"No automatic promotion, termination or high-potential decision.","Otomatik terfi, işten çıkarma veya yüksek potansiyel kararı verilmez.")}</small></span></div><div><Activity size={17}/><span><strong>{c(locale,"Calibration required","Kalibrasyon zorunlu")}</strong><small>{c(locale,"Changes remain auditable and purpose-bound.","Değişiklikler denetlenebilir ve amaçla sınırlı kalır.")}</small></span></div></div></aside></section></>;
}

function SuccessionWorkspace({ locale }: { locale: Locale }) {
  return <><section className="growth-metrics"><Metric icon={<BriefcaseBusiness size={18}/>} label={c(locale,"Critical positions","Kritik pozisyonlar")} value="37" meta={c(locale,"Enterprise critical-role register","Kurumsal kritik rol envanteri")}/><Metric icon={<CheckCircle2 size={18}/>} label={c(locale,"Covered","Kapsanan")} value="28" meta={c(locale,"At least one successor identified","En az bir halef belirlendi")}/><Metric icon={<Award size={18}/>} label={c(locale,"Ready now","Şimdi hazır")} value="17" meta={c(locale,"Across 14 critical positions","14 kritik pozisyonda")}/><Metric icon={<Activity size={18}/>} label={c(locale,"Coverage gaps","Kapsam açıkları")} value="9" meta={c(locale,"3 executive · 6 specialist roles","3 yönetici · 6 uzman rol")}/></section><section className="growth-split"><div className="card growth-panel"><div className="growth-panel-head"><div><span className="section-kicker">{c(locale,"Critical role continuity","Kritik rol sürekliliği")}</span><h3>{c(locale,"Succession coverage","Yedekleme kapsamı")}</h3></div><button><MoreHorizontal size={18}/></button></div><div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>{c(locale,"Position","Pozisyon")}</th><th>{c(locale,"Organization","Organizasyon")}</th><th>{c(locale,"Criticality","Kritiklik")}</th><th>{c(locale,"Candidates","Adaylar")}</th><th>{c(locale,"Ready now","Şimdi hazır")}</th><th>{c(locale,"Coverage","Kapsam")}</th></tr></thead><tbody>{successionRows.map((r)=><tr key={r[0]}>{r.slice(0,5).map((v,i)=><td key={i}>{localized(locale,v)}</td>)}<td><Pill value={r[5]} locale={locale}/></td></tr>)}</tbody></table></div></div><aside className="card growth-side"><div className="growth-panel-head"><div><span className="section-kicker">{c(locale,"Readiness","Hazırlık")}</span><h3>{c(locale,"Pipeline distribution","Aday havuzu dağılımı")}</h3></div></div><div className="readiness-list"><div><span>{c(locale,"Ready now","Şimdi hazır")}</span><strong>17</strong><i style={{width:"78%"}}/></div><div><span>{c(locale,"< 1 year","< 1 yıl")}</span><strong>24</strong><i style={{width:"92%"}}/></div><div><span>{c(locale,"1–2 years","1–2 yıl")}</span><strong>31</strong><i style={{width:"100%"}}/></div><div><span>{c(locale,"2+ years","2+ yıl")}</span><strong>18</strong><i style={{width:"62%"}}/></div></div></aside></section></>;
}

function LearningWorkspace({ locale }: { locale: Locale }) {
  return <><section className="growth-metrics"><Metric icon={<BookOpenCheck size={18}/>} label={c(locale,"Mandatory compliance","Zorunlu uyum") } value="94.8%" meta={c(locale,"Across active assignments","Aktif atamalarda")}/><Metric icon={<GraduationCap size={18}/>} label={c(locale,"Skills catalog","Yetkinlik kataloğu")} value="126" meta={c(locale,"18 marked business-critical","18'i iş-kritik olarak işaretli")}/><Metric icon={<Activity size={18}/>} label={c(locale,"Critical skill gaps","Kritik yetkinlik açıkları")} value="18" meta={c(locale,"Across 11 roles","11 rol genelinde")}/><Metric icon={<Target size={18}/>} label={c(locale,"Due in 30 days","30 gün içinde süresi dolacak")} value="42" meta={c(locale,"7 already escalated","7 kayıt eskale edildi")}/></section><section className="growth-split"><div className="card growth-panel"><div className="growth-panel-head"><div><span className="section-kicker">{c(locale,"Learning compliance","Eğitim uyumu")}</span><h3>{c(locale,"Assigned learning","Atanmış eğitimler")}</h3></div><button><MoreHorizontal size={18}/></button></div><div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>{c(locale,"Course","Eğitim")}</th><th>{c(locale,"Domain","Alan")}</th><th>{c(locale,"Requirement","Gereklilik")}</th><th>{c(locale,"Completed","Tamamlanan")}</th><th>{c(locale,"Due","Son tarih")}</th><th>{c(locale,"Rate","Oran")}</th></tr></thead><tbody>{learningRows.map((r)=><tr key={r[0]}>{r.map((v,i)=><td key={i}>{localized(locale,v)}</td>)}</tr>)}</tbody></table></div></div><aside className="card growth-side"><div className="growth-panel-head"><div><span className="section-kicker">{c(locale,"Skills intelligence","Yetkinlik zekâsı")}</span><h3>{c(locale,"Critical capability gaps","Kritik yetkinlik açıkları")}</h3></div></div><div className="skill-list"><div><span>{c(locale,"Cloud security architecture","Bulut güvenlik mimarisi")}</span><strong>{c(locale,"8 gaps","8 açık")}</strong></div><div><span>{c(locale,"AI governance","AI yönetişimi")}</span><strong>{c(locale,"5 gaps","5 açık")}</strong></div><div><span>{c(locale,"People leadership","İnsan liderliği")}</span><strong>{c(locale,"3 gaps","3 açık")}</strong></div><div><span>{c(locale,"Data privacy engineering","Veri gizliliği mühendisliği")}</span><strong>{c(locale,"2 gaps","2 açık")}</strong></div></div></aside></section></>;
}

export async function GrowthWorkspace({ slug }: { slug: string }) {
  const locale = await getServerLocale();
  return <div className="growth-shell">{slug === "benefits" ? <BenefitsWorkspace locale={locale}/> : slug === "performance" ? <PerformanceWorkspace locale={locale}/> : slug === "talent" ? <TalentWorkspace locale={locale}/> : slug === "succession" ? <SuccessionWorkspace locale={locale}/> : <LearningWorkspace locale={locale}/>}</div>;
}
