"use client";

import { BookOpenCheck, CheckCircle2, Route, ShieldCheck, Sparkles, Target } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { DevelopmentPlanParticipantRow } from "@/lib/development-plan-participant-data";

function label(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = {
    ACTIVE: "Aktif",
    COMPLETED: "Tamamlandı",
    AWARENESS: "Farkındalık",
    FOUNDATION: "Temel",
    PRACTITIONER: "Uygulayıcı",
    ADVANCED: "İleri",
    EXPERT: "Uzman"
  };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function dateOnly(value: string | null, locale: "en" | "tr") {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { dateStyle: "medium" }).format(new Date(value));
}

export function DevelopmentPlanParticipantConsole({ plans }: { plans: DevelopmentPlanParticipantRow[] }) {
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  if (!plans.length) return null;

  return <section className="performance-console card growth-lifecycle-console">
    <div className="performance-console-head">
      <div>
        <span className="section-kicker">{c("My development", "Gelişimim")}</span>
        <h3>{c("Individual development plans", "Bireysel gelişim planlarım")}</h3>
        <p>{c("See active development objectives, linked learning evidence and human-assessed skill progress for your own employment record. Course completion is evidence; proficiency and talent decisions remain human-owned.", "Kendi istihdam kaydınız için aktif gelişim hedeflerini, bağlı eğitim kanıtlarını ve insan tarafından değerlendirilmiş yetkinlik ilerlemesini görün. Eğitim tamamlama yalnızca kanıttır; yetkinlik ve yetenek kararları insan sahipliğinde kalır.")}</p>
      </div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Own-record view", "Kendi kayıt görünümü")}</span></div>
    </div>

    <div className="growth-lifecycle-list">{plans.map((plan) => <article className="performance-ops-panel" key={plan.id}>
      <div className="performance-panel-title">
        <Route size={16}/>
        <div><strong>{plan.title}</strong><small>{c("Owner", "Sahip")}: {plan.owner}{plan.sourceCycleLabel ? ` · ${plan.sourceCycleLabel}` : ""}</small></div>
        <em className={`growth-pill ${plan.status.toLowerCase()}`}>{label(plan.status, locale)}</em>
      </div>

      <div className="growth-lifecycle-copy" style={{ marginBottom: 10 }}>
        {plan.objective ? <span>{plan.objective}</span> : null}
        <span><Target size={11}/> {dateOnly(plan.startsAt, locale)} → {dateOnly(plan.targetAt, locale)}</span>
        {plan.focusSkillName && plan.targetProficiency ? <span><Sparkles size={11}/> {plan.focusSkillCode} · {plan.focusSkillName} · {c("Current", "Mevcut")}: {plan.currentProficiency ? label(plan.currentProficiency, locale) : "—"} → {c("Target", "Hedef")}: {label(plan.targetProficiency, locale)}{plan.successionLinked ? ` · ${c("succession-linked", "yedeklemeye bağlı")}` : ""}</span> : null}
      </div>

      <div className="performance-operation review-operation">
        <div className="performance-operation-main"><strong>{c("Learning evidence", "Eğitim kanıtı")}</strong><small>{plan.learningCompleted}/{plan.learningTotal} {c("actions completed or waived", "aksiyon tamamlandı veya muaf edildi")}</small></div>
        <div className="performance-review-controls"><span className="performance-console-health"><BookOpenCheck size={14}/>{plan.learningOpen ? c(`${plan.learningOpen} open`, `${plan.learningOpen} açık`) : c("All learning actions closed", "Tüm eğitim aksiyonları kapalı")}</span></div>
      </div>

      {plan.status === "COMPLETED" ? <div className="growth-lifecycle-copy" style={{ marginTop: 10 }}><span><CheckCircle2 size={11}/> {c("Completed", "Tamamlandı")}: {dateOnly(plan.completedAt, locale)}</span>{plan.outcomeNotes ? <span>{c("Human-confirmed outcome", "İnsan doğrulamalı sonuç")}: {plan.outcomeNotes}</span> : null}</div> : null}
    </article>)}</div>
  </section>;
}
