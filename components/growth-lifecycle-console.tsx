"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Clock3, GraduationCap, HeartHandshake, ShieldCheck } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import type { BenefitEnrollmentOperation, LearningAssignmentOperation } from "@/lib/growth-lifecycle-data";

type Props =
  | { slug: "benefits"; enrollments: BenefitEnrollmentOperation[]; assignments?: never }
  | { slug: "learning"; assignments: LearningAssignmentOperation[]; enrollments?: never };

const benefitTransitions: Record<string, string[]> = {
  PENDING: ["ACTIVE", "WAIVED", "ENDED"],
  ACTIVE: ["SUSPENDED", "ENDED"],
  SUSPENDED: ["ACTIVE", "ENDED"]
};
const learningTransitions: Record<string, string[]> = {
  ASSIGNED: ["IN_PROGRESS", "OVERDUE", "WAIVED"],
  IN_PROGRESS: ["COMPLETED", "OVERDUE", "WAIVED"],
  OVERDUE: ["IN_PROGRESS", "COMPLETED", "WAIVED"]
};

function label(value: string, locale: "en" | "tr") {
  const tr: Record<string, string> = {
    PENDING: "Bekliyor", ACTIVE: "Aktif", WAIVED: "Muaf", SUSPENDED: "Askıda", ENDED: "Sona erdi",
    ASSIGNED: "Atandı", IN_PROGRESS: "Devam ediyor", COMPLETED: "Tamamlandı", OVERDUE: "Gecikmiş"
  };
  if (locale === "tr" && tr[value]) return tr[value];
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function dateOnly(value: string | null) { return value ? value.slice(0, 10) : "—"; }

export function GrowthLifecycleConsole(props: Props) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function transition(key: string, url: string, payload: Record<string, unknown>) {
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`, `İstek başarısız (${response.status})`));
      setNotice({ tone: "ok", text: c("Lifecycle transition completed and audit evidence written.", "Yaşam döngüsü geçişi tamamlandı ve denetim kanıtı yazıldı.") });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Transaction failed.", "İşlem başarısız.") });
    } finally {
      setPending(null);
    }
  }

  return <section className="performance-console card growth-lifecycle-console">
    <div className="performance-console-head">
      <div><span className="section-kicker">{props.slug === "benefits" ? c("Enrollment lifecycle", "Kayıt yaşam döngüsü") : c("Learning execution", "Eğitim yürütme")}</span><h3>{props.slug === "benefits" ? c("Governed benefit elections", "Yönetişimli yan hak seçimleri") : c("Governed learning assignments", "Yönetişimli eğitim atamaları")}</h3><p>{props.slug === "benefits" ? c("Approve, suspend, waive or end employee benefit elections without overwriting historical effective dates.", "Çalışan yan hak seçimlerini tarihsel geçerlilik bilgisini ezmeden etkinleştirin, askıya alın, muaf tutun veya sonlandırın.") : c("Move learning obligations through explicit assignment states and retain completion evidence.", "Eğitim yükümlülüklerini açık atama durumlarından ilerletin ve tamamlama kanıtını koruyun.")}</p></div>
      <div className="performance-console-health"><ShieldCheck size={16}/><span>{c("Lifecycle controls active", "Yaşam döngüsü kontrolleri aktif")}</span></div>
    </div>
    {notice ? <div className={`performance-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}
    {props.slug === "benefits" ? <BenefitQueue rows={props.enrollments}/> : <LearningQueue rows={props.assignments}/>}
  </section>;

  function BenefitQueue({ rows }: { rows: BenefitEnrollmentOperation[] }) {
    return <div className="growth-lifecycle-list">{rows.length ? rows.map((row) => <article className="growth-lifecycle-row" key={row.id}>
      <div className="growth-lifecycle-icon"><HeartHandshake size={16}/></div>
      <div className="growth-lifecycle-copy"><strong>{row.person}</strong><small>{row.employeeNumber} · {row.planCode} · {row.plan}</small><span>{c("Coverage", "Kapsam")}: {row.coverageTier} · {dateOnly(row.effectiveFrom)} → {dateOnly(row.effectiveTo)}</span></div>
      <em className={`growth-pill ${row.status.toLowerCase().replaceAll("_", "-")}`}>{label(row.status, locale)}</em>
      <div className="growth-lifecycle-actions">{(benefitTransitions[row.status] ?? []).map((next) => <button className="secondary-button" type="button" key={next} disabled={pending !== null} onClick={() => void transition(`benefit-${row.id}-${next}`, `/api/benefits/enrollments/${row.id}/transition`, { status: next })}>{pending === `benefit-${row.id}-${next}` ? "…" : label(next, locale)}</button>)}</div>
    </article>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No active benefit elections require lifecycle action.", "Yaşam döngüsü aksiyonu gerektiren aktif yan hak seçimi yok.")}</span></div>}</div>;
  }

  function LearningQueue({ rows }: { rows: LearningAssignmentOperation[] }) {
    return <div className="growth-lifecycle-list">{rows.length ? rows.map((row) => <article className="growth-lifecycle-row" key={row.id}>
      <div className="growth-lifecycle-icon"><GraduationCap size={16}/></div>
      <div className="growth-lifecycle-copy"><strong>{row.person}</strong><small>{row.employeeNumber} · {row.courseCode} · {row.course}</small><span>{row.mandatory ? c("Mandatory", "Zorunlu") : c("Development", "Gelişim")} · <Clock3 size={11}/> {c("Due", "Son tarih")} {dateOnly(row.dueAt)}</span></div>
      <em className={`growth-pill ${row.status.toLowerCase().replaceAll("_", "-")}`}>{label(row.status, locale)}</em>
      <div className="growth-lifecycle-actions">{(learningTransitions[row.status] ?? []).map((next) => <button className="secondary-button" type="button" key={next} disabled={pending !== null} onClick={() => void transition(`learning-${row.id}-${next}`, `/api/learning/assignments/${row.id}/transition`, { status: next })}>{pending === `learning-${row.id}-${next}` ? "…" : label(next, locale)}</button>)}</div>
    </article>) : <div className="growth-lifecycle-empty"><CheckCircle2 size={18}/><span>{c("No open learning assignments require action.", "Aksiyon gerektiren açık eğitim ataması yok.")}</span></div>}</div>;
  }
}
