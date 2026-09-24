"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenCheck, CheckCircle2, CircleAlert, GraduationCap, ShieldCheck, Sparkles } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { LearningGovernanceData } from "@/lib/learning-governance-data";

const proficiencies = ["AWARENESS", "FOUNDATION", "PRACTITIONER", "ADVANCED", "EXPERT"];

function label(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = {
    AWARENESS: "Farkındalık",
    FOUNDATION: "Temel",
    PRACTITIONER: "Uygulayıcı",
    ADVANCED: "İleri",
    EXPERT: "Uzman"
  };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function dateOnly(value: string, locale: "en" | "tr") {
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { dateStyle: "medium" }).format(new Date(value));
}

export function LearningGovernanceConsole({ courses, skills, employmentSkills }: LearningGovernanceData) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function patch(key: string, url: string, payload: Record<string, unknown>) {
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`, `İstek başarısız (${response.status})`));
      setNotice({ tone: "ok", text: c("Learning governance record updated and audit evidence written.", "Öğrenme yönetişim kaydı güncellendi ve denetim kanıtı yazıldı.") });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Transaction failed.", "İşlem başarısız.") });
    } finally {
      setPending(null);
    }
  }

  return <section className="performance-console card growth-lifecycle-console">
    <div className="performance-console-head">
      <div><span className="section-kicker">{c("Learning governance", "Öğrenme yönetişimi")}</span><h3>{c("Course, skill and proficiency controls", "Eğitim, yetkinlik ve seviye kontrolleri")}</h3><p>{c("Maintain catalog lifecycle and human-assessed employee proficiency without deleting historical assignments or assessment evidence.", "Tarihsel atamaları veya değerlendirme kanıtlarını silmeden katalog yaşam döngüsünü ve insan değerlendirmeli çalışan yetkinlik seviyelerini yönetin.")}</p></div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Audit-backed catalog", "Denetim izli katalog")}</span></div>
    </div>

    {notice ? <div className={`performance-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}

    <div className="performance-ops-panel">
      <div className="performance-panel-title"><BookOpenCheck size={16}/><div><strong>{c("Learning course catalog", "Eğitim kataloğu")}</strong><small>{c(`${courses.length} courses including inactive history`, `Pasif geçmiş dahil ${courses.length} eğitim`)}</small></div></div>
      <div className="growth-lifecycle-list">{courses.length ? courses.map((course) => <form className="growth-lifecycle-row" key={course.id} onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void patch(`course-${course.id}`, `/api/learning/courses/${course.id}`, {
          title: data.get("title"),
          provider: data.get("provider") || null,
          mandatory: data.get("mandatory") === "on",
          validityMonths: data.get("validityMonths") || null
        });
      }}>
        <div className="growth-lifecycle-icon"><GraduationCap size={16}/></div>
        <div className="growth-lifecycle-copy"><strong>{course.code}</strong><small>{course.assignments} {c("scoped assignments", "kapsamlı atama")} · {course.active ? c("Active", "Aktif") : c("Inactive", "Pasif")}</small><span>{course.validityMonths ? c(`Validity ${course.validityMonths} months`, `Geçerlilik ${course.validityMonths} ay`) : c("No certificate expiry rule", "Sertifika süre sonu kuralı yok")}</span></div>
        <div className="performance-review-controls"><input name="title" defaultValue={course.title} maxLength={250}/><input name="provider" defaultValue={course.provider ?? ""} maxLength={250} placeholder={c("Provider", "Sağlayıcı")}/><input name="validityMonths" type="number" min="1" max="120" defaultValue={course.validityMonths ?? ""} placeholder={c("Validity months", "Geçerlilik ayı")}/><label className="growth-check"><input name="mandatory" type="checkbox" defaultChecked={course.mandatory}/> {c("Mandatory", "Zorunlu")}</label><button className="secondary-button" disabled={pending !== null}>{pending === `course-${course.id}` ? "…" : c("Save", "Kaydet")}</button><button className="secondary-button" type="button" disabled={pending !== null} onClick={() => void patch(`course-state-${course.id}`, `/api/learning/courses/${course.id}`, { active: !course.active })}>{pending === `course-state-${course.id}` ? "…" : course.active ? c("Deactivate", "Pasife al") : c("Reactivate", "Etkinleştir")}</button></div>
      </form>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No learning courses are configured.", "Eğitim kaydı yapılandırılmamış.")}</span></div>}</div>
    </div>

    <div className="performance-ops-panel">
      <div className="performance-panel-title"><Sparkles size={16}/><div><strong>{c("Skill catalog", "Yetkinlik kataloğu")}</strong><small>{c(`${skills.length} skills including inactive history`, `Pasif geçmiş dahil ${skills.length} yetkinlik`)}</small></div></div>
      <div className="growth-lifecycle-list">{skills.length ? skills.map((skill) => <form className="growth-lifecycle-row" key={skill.id} onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void patch(`skill-${skill.id}`, `/api/learning/skills/${skill.id}`, {
          name: data.get("name"),
          category: data.get("category") || null,
          critical: data.get("critical") === "on"
        });
      }}>
        <div className="growth-lifecycle-icon"><Sparkles size={16}/></div>
        <div className="growth-lifecycle-copy"><strong>{skill.code}</strong><small>{skill.assessed} {c("assessed employments", "değerlendirilmiş istihdam")} · {skill.active ? c("Active", "Aktif") : c("Inactive", "Pasif")}</small><span>{skill.critical ? c("Critical capability", "Kritik yetkinlik") : c("Standard capability", "Standart yetkinlik")}</span></div>
        <div className="performance-review-controls"><input name="name" defaultValue={skill.name} maxLength={250}/><input name="category" defaultValue={skill.category ?? ""} maxLength={250} placeholder={c("Category", "Kategori")}/><label className="growth-check"><input name="critical" type="checkbox" defaultChecked={skill.critical}/> {c("Critical", "Kritik")}</label><button className="secondary-button" disabled={pending !== null}>{pending === `skill-${skill.id}` ? "…" : c("Save", "Kaydet")}</button><button className="secondary-button" type="button" disabled={pending !== null} onClick={() => void patch(`skill-state-${skill.id}`, `/api/learning/skills/${skill.id}`, { active: !skill.active })}>{pending === `skill-state-${skill.id}` ? "…" : skill.active ? c("Deactivate", "Pasife al") : c("Reactivate", "Etkinleştir")}</button></div>
      </form>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No skills are configured.", "Yetkinlik kaydı yapılandırılmamış.")}</span></div>}</div>
    </div>

    <div className="performance-ops-panel">
      <div className="performance-panel-title"><ShieldCheck size={16}/><div><strong>{c("Employee proficiency register", "Çalışan yetkinlik seviye kayıtları")}</strong><small>{c("Human-assessed proficiency with source evidence", "Kaynak kanıtlı insan değerlendirmesi")}</small></div></div>
      <div className="growth-lifecycle-list">{employmentSkills.length ? employmentSkills.map((record) => <form className="growth-lifecycle-row" key={record.id} onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void patch(`proficiency-${record.id}`, `/api/learning/employment-skills/${record.id}`, { proficiency: data.get("proficiency"), source: data.get("source") || null });
      }}>
        <div className="growth-lifecycle-icon"><ShieldCheck size={16}/></div>
        <div className="growth-lifecycle-copy"><strong>{record.person} · {record.skill}</strong><small>{record.employeeNumber} · {record.skillCode} · {record.position}</small><span>{record.organization} · {c("Assessed", "Değerlendirildi")} {dateOnly(record.assessedAt, locale)}</span></div>
        <div className="performance-review-controls"><select name="proficiency" defaultValue={record.proficiency}>{proficiencies.map((value) => <option key={value} value={value}>{label(value, locale)}</option>)}</select><input name="source" maxLength={500} defaultValue={record.source ?? ""} placeholder={c("Evidence / assessment source", "Kanıt / değerlendirme kaynağı")}/><button className="secondary-button" disabled={pending !== null}>{pending === `proficiency-${record.id}` ? "…" : c("Reassess", "Yeniden değerlendir")}</button></div>
      </form>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No employee skill assessments are available in your authorized scope.", "Yetkili kapsamınızda çalışan yetkinlik değerlendirmesi yok.")}</span></div>}</div>
    </div>
  </section>;
}
