"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Award, BookOpenCheck, CheckCircle2, CircleAlert, GraduationCap, HeartHandshake, ShieldCheck, Sparkles, UserPlus, UsersRound } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { GrowthOperationsData } from "@/lib/growth-operations-data";

type GrowthWriteSlug = "benefits" | "talent" | "succession" | "learning";
type Props = GrowthOperationsData & { slug: GrowthWriteSlug };

const benefitTypes = ["HEALTH", "DENTAL", "VISION", "LIFE", "RETIREMENT", "MEAL", "TRANSPORT", "FLEXIBLE", "OTHER"];
const performanceBands = ["NEEDS_IMPROVEMENT", "DEVELOPING", "MEETS", "EXCEEDS", "OUTSTANDING"];
const potentialBands = ["LIMITED", "MODERATE", "HIGH"];
const readinessBands = ["READY_NOW", "READY_LT_1_YEAR", "READY_1_2_YEARS", "READY_2_PLUS_YEARS"];
const proficiencies = ["AWARENESS", "FOUNDATION", "PRACTITIONER", "ADVANCED", "EXPERT"];

function label(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = {
    HEALTH: "Sağlık", DENTAL: "Diş", VISION: "Göz", LIFE: "Hayat", RETIREMENT: "Emeklilik", MEAL: "Yemek", TRANSPORT: "Ulaşım", FLEXIBLE: "Esnek", OTHER: "Diğer",
    NEEDS_IMPROVEMENT: "Gelişim gerekli", DEVELOPING: "Gelişiyor", MEETS: "Beklentiyi karşılıyor", EXCEEDS: "Beklentiyi aşıyor", OUTSTANDING: "Üstün",
    LIMITED: "Sınırlı", MODERATE: "Orta", HIGH: "Yüksek", READY_NOW: "Şimdi hazır", READY_LT_1_YEAR: "1 yıldan kısa", READY_1_2_YEARS: "1-2 yıl", READY_2_PLUS_YEARS: "2+ yıl",
    AWARENESS: "Farkındalık", FOUNDATION: "Temel", PRACTITIONER: "Uygulayıcı", ADVANCED: "İleri", EXPERT: "Uzman"
  };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export function GrowthOperationsConsole({ slug, employments, positions, benefitPlans, successionPlans, courses, skills }: Props) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function post(key: string, url: string, payload: Record<string, unknown>, form?: HTMLFormElement) {
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`, `İstek başarısız (${response.status})`));
      setNotice({ tone: "ok", text: c("Governed HR record saved and audit evidence written.", "Yönetişimli İK kaydı kaydedildi ve denetim kanıtı yazıldı.") });
      form?.reset();
      router.refresh();
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Transaction failed.", "İşlem başarısız.") });
      return false;
    } finally {
      setPending(null);
    }
  }

  const titles: Record<GrowthWriteSlug, [string, string, string, string]> = {
    benefits: ["Benefits administration", "Yan hak yönetimi", "Effective-dated plans and employee elections", "Tarih-etkin planlar ve çalışan seçimleri"],
    talent: ["Talent assessment operations", "Yetenek değerlendirme operasyonları", "Explicit human assessments only", "Yalnızca açık insan değerlendirmeleri"],
    succession: ["Succession planning operations", "Yedekleme planlama operasyonları", "Position-centric continuity and readiness", "Pozisyon odaklı süreklilik ve hazırlık"],
    learning: ["Skills & learning operations", "Yetkinlik ve öğrenme operasyonları", "Governed catalog, assignments and evidence", "Yönetişimli katalog, atama ve kanıt"]
  };
  const title = titles[slug];

  return <section className="performance-console card">
    <div className="performance-console-head">
      <div><span className="section-kicker">{c(title[0], title[1])}</span><h3>{c(title[2], title[3])}</h3><p>{c("Write actions are tenant-scoped, relationship-aware and audit logged. Public staging never mounts this console.", "Yazma işlemleri tenant kapsamlıdır, ilişki farkındalığı taşır ve denetim kaydı üretir. Genel staging bu konsolu hiçbir zaman yüklemez.")}</p></div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Write controls active", "Yazma kontrolleri aktif")}</span></div>
    </div>
    {notice ? <div className={`performance-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}
    {slug === "benefits" ? <BenefitsForms/> : slug === "talent" ? <TalentForms/> : slug === "succession" ? <SuccessionForms/> : <LearningForms/>}
  </section>;

  function EmploymentSelect({ name = "employmentId" }: { name?: string }) {
    return <select name={name} required defaultValue=""><option value="" disabled>{c("Select employee", "Çalışan seçin")}</option>{employments.map((employment) => <option key={employment.id} value={employment.id}>{employment.person} · {employment.position}</option>)}</select>;
  }

  function BenefitsForms() {
    return <div className="performance-create-grid">
      <form className="performance-form" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void post("benefit-plan", "/api/benefits/plans", { code: data.get("code"), name: data.get("name"), type: data.get("type"), provider: data.get("provider") || null, countryCode: data.get("countryCode") || null, currency: data.get("currency") || null, employerContribution: data.get("employerContribution") || null, employeeContribution: data.get("employeeContribution") || null, effectiveFrom: data.get("effectiveFrom") }, form); }}>
        <div className="performance-form-title"><HeartHandshake size={17}/><div><strong>{c("Create benefit plan", "Yan hak planı oluştur")}</strong><small>{c("Effective-dated catalog record", "Tarih-etkin katalog kaydı")}</small></div></div>
        <div className="performance-form-row"><label>{c("Code", "Kod")}<input name="code" required/></label><label>{c("Type", "Tür")}<select name="type" required defaultValue="HEALTH">{benefitTypes.map((value) => <option key={value} value={value}>{label(value, locale)}</option>)}</select></label></div>
        <label>{c("Plan name", "Plan adı")}<input name="name" required/></label><label>{c("Provider", "Sağlayıcı")}<input name="provider"/></label>
        <div className="performance-form-row"><label>{c("Country", "Ülke")}<input name="countryCode" maxLength={2} placeholder="TR"/></label><label>{c("Currency", "Para birimi")}<input name="currency" maxLength={3} placeholder="TRY"/></label></div>
        <div className="performance-form-row"><label>{c("Employer contribution", "İşveren katkısı")}<input name="employerContribution" type="number" min="0" step="0.01"/></label><label>{c("Employee contribution", "Çalışan katkısı")}<input name="employeeContribution" type="number" min="0" step="0.01"/></label></div>
        <label>{c("Effective from", "Geçerlilik başlangıcı")}<input name="effectiveFrom" type="date" required/></label>
        <button className="create-button" disabled={pending !== null}>{pending === "benefit-plan" ? "…" : c("Create plan", "Plan oluştur")}</button>
      </form>
      <form className="performance-form" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void post("benefit-enrollment", "/api/benefits/enrollments", { employmentId: data.get("employmentId"), benefitPlanId: data.get("benefitPlanId"), coverageTier: data.get("coverageTier") || null, effectiveFrom: data.get("effectiveFrom") }, form); }}>
        <div className="performance-form-title"><UserPlus size={17}/><div><strong>{c("Enroll employee", "Çalışanı kaydet")}</strong><small>{c("Pending election with effective date", "Geçerlilik tarihli bekleyen seçim")}</small></div></div>
        <label>{c("Employee", "Çalışan")}<EmploymentSelect/></label>
        <label>{c("Benefit plan", "Yan hak planı")}<select name="benefitPlanId" required defaultValue=""><option value="" disabled>{c("Select plan", "Plan seçin")}</option>{benefitPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.code} · {plan.name}</option>)}</select></label>
        <label>{c("Coverage tier", "Kapsam seviyesi")}<input name="coverageTier" placeholder={c("Employee + family", "Çalışan + aile")}/></label>
        <label>{c("Effective from", "Geçerlilik başlangıcı")}<input name="effectiveFrom" type="date" required/></label>
        <button className="create-button" disabled={pending !== null || !employments.length || !benefitPlans.length}>{pending === "benefit-enrollment" ? "…" : c("Create pending enrollment", "Bekleyen kayıt oluştur")}</button>
      </form>
    </div>;
  }

  function TalentForms() {
    return <div className="performance-create-grid">
      <form className="performance-form" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void post("talent-assessment", "/api/talent/assessments", { employmentId: data.get("employmentId"), cycleLabel: data.get("cycleLabel"), performance: data.get("performance"), potential: data.get("potential"), criticalTalent: data.get("criticalTalent") === "on", notes: data.get("notes") || null }, form); }}>
        <div className="performance-form-title"><Award size={17}/><div><strong>{c("Record talent assessment", "Yetenek değerlendirmesi kaydet")}</strong><small>{c("Human-reviewed performance × potential", "İnsan değerlendirmeli performans × potansiyel")}</small></div></div>
        <label>{c("Employee", "Çalışan")}<EmploymentSelect/></label><label>{c("Cycle label", "Döngü etiketi")}<input name="cycleLabel" required placeholder="FY27 Talent Review"/></label>
        <div className="performance-form-row"><label>{c("Performance", "Performans")}<select name="performance" required defaultValue="MEETS">{performanceBands.map((value) => <option key={value} value={value}>{label(value, locale)}</option>)}</select></label><label>{c("Potential", "Potansiyel")}<select name="potential" required defaultValue="MODERATE">{potentialBands.map((value) => <option key={value} value={value}>{label(value, locale)}</option>)}</select></label></div>
        <label className="growth-check"><input name="criticalTalent" type="checkbox"/> {c("Critical talent designation", "Kritik yetenek işareti")}</label>
        <label>{c("Assessment notes", "Değerlendirme notları")}<textarea name="notes" rows={3}/></label>
        <button className="create-button" disabled={pending !== null || !employments.length}>{pending === "talent-assessment" ? "…" : c("Save human assessment", "İnsan değerlendirmesini kaydet")}</button>
      </form>
      <div className="performance-form growth-principle-card"><div className="performance-form-title"><Sparkles size={17}/><div><strong>{c("Decision boundary", "Karar sınırı")}</strong><small>{c("AI may assist evidence, not decide", "AI kanıta yardımcı olabilir, karar vermez")}</small></div></div><p>{c("Potential, performance and critical-talent designations remain explicit records entered by authorized people. No hidden model score is persisted or converted into an automatic promotion decision.", "Potansiyel, performans ve kritik-yetenek işaretleri yetkili kişilerce girilen açık kayıtlardır. Gizli model skoru saklanmaz ve otomatik terfi kararına dönüştürülmez.")}</p></div>
    </div>;
  }

  function SuccessionForms() {
    return <div className="performance-create-grid">
      <form className="performance-form" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void post("succession-plan", "/api/succession/plans", { positionId: data.get("positionId"), name: data.get("name") || null, reviewDueAt: data.get("reviewDueAt") || null }, form); }}>
        <div className="performance-form-title"><UsersRound size={17}/><div><strong>{c("Create or refresh plan", "Plan oluştur veya yenile")}</strong><small>{c("Position-centric continuity record", "Pozisyon odaklı süreklilik kaydı")}</small></div></div>
        <label>{c("Target position", "Hedef pozisyon")}<select name="positionId" required defaultValue=""><option value="" disabled>{c("Select position", "Pozisyon seçin")}</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.code} · {position.title}{position.critical ? ` · ${c("Critical", "Kritik")}` : ""}</option>)}</select></label>
        <label>{c("Plan name", "Plan adı")}<input name="name"/></label><label>{c("Review due", "İnceleme tarihi")}<input name="reviewDueAt" type="date"/></label>
        <button className="create-button" disabled={pending !== null || !positions.length}>{pending === "succession-plan" ? "…" : c("Save succession plan", "Yedekleme planını kaydet")}</button>
      </form>
      <form className="performance-form" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void post("succession-candidate", "/api/succession/candidates", { planId: data.get("planId"), employmentId: data.get("employmentId"), readiness: data.get("readiness"), rank: data.get("rank") || null, developmentGap: data.get("developmentGap") || null }, form); }}>
        <div className="performance-form-title"><UserPlus size={17}/><div><strong>{c("Add successor candidate", "Yedek aday ekle")}</strong><small>{c("Human-assessed readiness", "İnsan değerlendirmeli hazırlık")}</small></div></div>
        <label>{c("Succession plan", "Yedekleme planı")}<select name="planId" required defaultValue=""><option value="" disabled>{c("Select plan", "Plan seçin")}</option>{successionPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.positionCode} · {plan.position}</option>)}</select></label>
        <label>{c("Candidate", "Aday")}<EmploymentSelect/></label><label>{c("Readiness", "Hazırlık")}<select name="readiness" required defaultValue="READY_1_2_YEARS">{readinessBands.map((value) => <option key={value} value={value}>{label(value, locale)}</option>)}</select></label>
        <div className="performance-form-row"><label>{c("Rank", "Sıra")}<input name="rank" type="number" min="1"/></label><label>{c("Development gap", "Gelişim açığı")}<input name="developmentGap"/></label></div>
        <button className="create-button" disabled={pending !== null || !successionPlans.length || !employments.length}>{pending === "succession-candidate" ? "…" : c("Save candidate", "Adayı kaydet")}</button>
      </form>
    </div>;
  }

  function LearningForms() {
    return <div className="performance-create-grid growth-four-forms">
      <form className="performance-form" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void post("learning-course", "/api/learning/courses", { code: data.get("code"), title: data.get("title"), provider: data.get("provider") || null, mandatory: data.get("mandatory") === "on", validityMonths: data.get("validityMonths") || null }, form); }}>
        <div className="performance-form-title"><BookOpenCheck size={17}/><div><strong>{c("Create course", "Eğitim oluştur")}</strong><small>{c("Governed learning catalog", "Yönetişimli eğitim kataloğu")}</small></div></div>
        <div className="performance-form-row"><label>{c("Code", "Kod")}<input name="code" required/></label><label>{c("Validity months", "Geçerlilik ayı")}<input name="validityMonths" type="number" min="1"/></label></div><label>{c("Title", "Başlık")}<input name="title" required/></label><label>{c("Provider", "Sağlayıcı")}<input name="provider"/></label><label className="growth-check"><input name="mandatory" type="checkbox"/> {c("Mandatory learning", "Zorunlu eğitim")}</label>
        <button className="create-button" disabled={pending !== null}>{pending === "learning-course" ? "…" : c("Create course", "Eğitim oluştur")}</button>
      </form>
      <form className="performance-form" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void post("learning-assignment", "/api/learning/assignments", { employmentId: data.get("employmentId"), courseId: data.get("courseId"), dueAt: data.get("dueAt") || null }, form); }}>
        <div className="performance-form-title"><GraduationCap size={17}/><div><strong>{c("Assign learning", "Eğitim ata")}</strong><small>{c("Employee learning obligation", "Çalışan eğitim yükümlülüğü")}</small></div></div>
        <label>{c("Employee", "Çalışan")}<EmploymentSelect/></label><label>{c("Course", "Eğitim")}<select name="courseId" required defaultValue=""><option value="" disabled>{c("Select course", "Eğitim seçin")}</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} · {course.title}{course.mandatory ? ` · ${c("Mandatory", "Zorunlu")}` : ""}</option>)}</select></label><label>{c("Due date", "Son tarih")}<input name="dueAt" type="date"/></label>
        <button className="create-button" disabled={pending !== null || !courses.length || !employments.length}>{pending === "learning-assignment" ? "…" : c("Assign course", "Eğitimi ata")}</button>
      </form>
      <form className="performance-form" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void post("skill-catalog", "/api/learning/skills", { code: data.get("code"), name: data.get("name"), category: data.get("category") || null, critical: data.get("critical") === "on" }, form); }}>
        <div className="performance-form-title"><Sparkles size={17}/><div><strong>{c("Create skill", "Yetkinlik oluştur")}</strong><small>{c("Reusable capability taxonomy", "Yeniden kullanılabilir yetkinlik taksonomisi")}</small></div></div>
        <div className="performance-form-row"><label>{c("Code", "Kod")}<input name="code" required/></label><label>{c("Category", "Kategori")}<input name="category"/></label></div><label>{c("Skill name", "Yetkinlik adı")}<input name="name" required/></label><label className="growth-check"><input name="critical" type="checkbox"/> {c("Critical skill", "Kritik yetkinlik")}</label>
        <button className="create-button" disabled={pending !== null}>{pending === "skill-catalog" ? "…" : c("Create skill", "Yetkinlik oluştur")}</button>
      </form>
      <form className="performance-form" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void post("employee-skill", "/api/learning/skills", { employmentId: data.get("employmentId"), skillId: data.get("skillId"), proficiency: data.get("proficiency"), source: data.get("source") || "HR review" }, form); }}>
        <div className="performance-form-title"><Award size={17}/><div><strong>{c("Assess employee skill", "Çalışan yetkinliğini değerlendir")}</strong><small>{c("Explicit proficiency evidence", "Açık yeterlilik kanıtı")}</small></div></div>
        <label>{c("Employee", "Çalışan")}<EmploymentSelect/></label><label>{c("Skill", "Yetkinlik")}<select name="skillId" required defaultValue=""><option value="" disabled>{c("Select skill", "Yetkinlik seçin")}</option>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.code} · {skill.name}{skill.critical ? ` · ${c("Critical", "Kritik")}` : ""}</option>)}</select></label><label>{c("Proficiency", "Yeterlilik")}<select name="proficiency" required defaultValue="FOUNDATION">{proficiencies.map((value) => <option key={value} value={value}>{label(value, locale)}</option>)}</select></label><label>{c("Evidence source", "Kanıt kaynağı")}<input name="source" placeholder={c("Manager review / certification", "Yönetici değerlendirmesi / sertifika")}/></label>
        <button className="create-button" disabled={pending !== null || !skills.length || !employments.length}>{pending === "employee-skill" ? "…" : c("Save proficiency", "Yeterliliği kaydet")}</button>
      </form>
    </div>;
  }
}
