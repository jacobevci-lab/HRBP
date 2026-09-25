"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, CheckCircle2, CircleAlert, FileCheck2, UserPlus, UsersRound } from "lucide-react";
import { useLocale } from "@/components/locale-provider";

type PositionOption = { id: string; code: string; title: string; organization: string; location: string };
type UserOption = { id: string; name: string; role: string };
type RequisitionOption = { id: string; title: string; status: string; position: string };
type ApplicationOperation = {
  id: string;
  candidate: string;
  requisition: string;
  stage: string;
  offer: null | { id: string; status: string; currency: string; annualBase: string; startDate: string; expiresAt: string | null };
};

type Props = {
  positions: PositionOption[];
  users: UserOption[];
  requisitions: RequisitionOption[];
  applications: ApplicationOperation[];
  canApprove: boolean;
};

const applicationTransitions: Record<string, string[]> = {
  APPLIED: ["SCREENING", "REJECTED", "WITHDRAWN"],
  SCREENING: ["INTERVIEW", "REJECTED", "WITHDRAWN"],
  INTERVIEW: ["ASSESSMENT", "REJECTED", "WITHDRAWN"],
  ASSESSMENT: ["INTERVIEW", "REJECTED", "WITHDRAWN"],
  OFFER: ["INTERVIEW", "ASSESSMENT", "REJECTED", "WITHDRAWN"]
};

const offerTransitions: Record<string, string[]> = {
  DRAFT: ["APPROVAL", "WITHDRAWN"],
  APPROVAL: ["DRAFT", "SENT", "WITHDRAWN"],
  SENT: ["ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN"],
  EXPIRED: ["DRAFT"],
  WITHDRAWN: ["DRAFT"]
};

const requisitionTransitions: Record<string, string[]> = {
  DRAFT: ["APPROVAL", "CANCELLED"],
  APPROVAL: ["DRAFT", "OPEN", "CANCELLED"],
  OPEN: ["ON_HOLD", "CLOSED", "CANCELLED"],
  ON_HOLD: ["OPEN", "CLOSED", "CANCELLED"]
};

function label(value: string, locale: "en" | "tr") {
  if (locale === "tr") {
    const labels: Record<string,string> = {
      EMPLOYEE:"Çalışan", MANAGER:"Yönetici", HRBP:"İK İş Ortağı", HR_OPERATIONS:"İK Operasyonları", TENANT_ADMIN:"Tenant Yöneticisi",
      DRAFT:"Taslak", APPROVAL:"Onay", OPEN:"Açık", ON_HOLD:"Beklemede", CLOSED:"Kapalı", CANCELLED:"İptal",
      APPLIED:"Başvurdu", SCREENING:"Ön Eleme", INTERVIEW:"Mülakat", ASSESSMENT:"Değerlendirme", OFFER:"Teklif", HIRED:"İşe Alındı", REJECTED:"Reddedildi", WITHDRAWN:"Geri Çekildi",
      SENT:"Gönderildi", ACCEPTED:"Kabul Edildi", DECLINED:"Reddedildi", EXPIRED:"Süresi Doldu"
    };
    if (labels[value]) return labels[value];
  }
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export function RecruitingOperationsConsole({ positions, users, requisitions, applications, canApprove }: Props) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en:string,tr:string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const openRequisitions = useMemo(() => requisitions.filter((requisition) => requisition.status === "OPEN"), [requisitions]);

  async function post(key: string, url: string, payload: Record<string, unknown>) {
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c(`Request failed (${response.status})`,`İstek başarısız (${response.status})`));
      setNotice({ tone: "ok", text: c("Transaction completed and written to the governed HR record.","İşlem tamamlandı ve yönetişimli İK kaydına yazıldı.") });
      router.refresh();
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Transaction failed.","İşlem başarısız.") });
      return false;
    } finally {
      setPending(null);
    }
  }

  async function submitRequisition(form: HTMLFormElement) {
    const data = new FormData(form);
    const ok = await post("requisition", "/api/recruiting/requisitions", {
      title: data.get("title"),
      positionId: data.get("positionId") || null,
      openings: Number(data.get("openings") || 1),
      hiringManagerId: data.get("hiringManagerId") || null,
      recruiterId: data.get("recruiterId") || null,
      targetHireDate: data.get("targetHireDate") || null
    });
    if (ok) form.reset();
  }

  async function submitCandidate(form: HTMLFormElement) {
    const data = new FormData(form);
    const ok = await post("candidate", "/api/recruiting/candidates", {
      givenName: data.get("givenName"),
      familyName: data.get("familyName"),
      email: data.get("email"),
      phone: data.get("phone"),
      source: data.get("source"),
      requisitionId: data.get("requisitionId"),
      privacyNoticeVersion: "2026.1",
      retentionUntil: data.get("retentionUntil") || null
    });
    if (ok) form.reset();
  }

  return <section className="ats-console card">
    <div className="ats-console-head">
      <div><span className="section-kicker">{c("Governed ATS transactions","Yönetişimli ATS işlemleri")}</span><h3>{c("Recruiting operations console","İşe alım operasyon konsolu")}</h3><p>{c("Preparation and independent approval are separated. Every mutation is tenant-scoped, state-validated and audit logged. Hire conversion creates the employee, employment, lifecycle event and onboarding plan in one transaction.","Hazırlama ve bağımsız onay ayrılmıştır. Her değişiklik tenant kapsamlıdır, durum doğrulamasından geçer ve denetim kaydı üretir. İşe alım dönüşümü çalışanı, istihdamı, yaşam döngüsü olayını ve işe başlatma planını tek işlemde oluşturur.")}</p></div>
      <div className="ats-console-health"><CheckCircle2 size={16}/><span>{canApprove ? c("Write + approval controls active","Yazma + onay kontrolleri aktif") : c("Preparation controls active","Hazırlama kontrolleri aktif")}</span></div>
    </div>

    {notice ? <div className={`ats-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}

    <div className="ats-create-grid">
      <form className="ats-form" onSubmit={(event) => { event.preventDefault(); void submitRequisition(event.currentTarget); }}>
        <div className="ats-form-title"><BriefcaseBusiness size={17}/><div><strong>{c("New requisition","Yeni işe alım talebi")}</strong><small>{c("Position-backed hiring demand","Pozisyon destekli işe alım ihtiyacı")}</small></div></div>
        <label>{c("Title","Başlık")}<input name="title" required placeholder="Senior Security Engineer"/></label>
        <div className="ats-form-row"><label>{c("Position","Pozisyon")}<select name="positionId" defaultValue=""><option value="">{c("Unassigned","Atanmamış")}</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.code} · {position.title} · {position.organization}</option>)}</select></label><label>{c("Openings","Açık kadro")}<input name="openings" type="number" min="1" defaultValue="1" required/></label></div>
        <div className="ats-form-row"><label>{c("Hiring manager","İşe alım yöneticisi")}<select name="hiringManagerId" defaultValue=""><option value="">{c("Not assigned","Atanmadı")}</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {label(user.role,locale)}</option>)}</select></label><label>{c("Recruiter","İşe alım uzmanı")}<select name="recruiterId" defaultValue=""><option value="">{c("Not assigned","Atanmadı")}</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {label(user.role,locale)}</option>)}</select></label></div>
        <label>{c("Target hire date","Hedef işe alım tarihi")}<input name="targetHireDate" type="date"/></label>
        <button className="create-button" disabled={pending !== null}>{pending === "requisition" ? c("Creating…","Oluşturuluyor…") : c("Create draft requisition","Taslak talep oluştur")}</button>
      </form>

      <form className="ats-form" onSubmit={(event) => { event.preventDefault(); void submitCandidate(event.currentTarget); }}>
        <div className="ats-form-title"><UserPlus size={17}/><div><strong>{c("Add candidate","Aday ekle")}</strong><small>{c("Restricted candidate master + application","Kısıtlı aday ana kaydı + başvuru")}</small></div></div>
        <div className="ats-form-row"><label>{c("First name","Ad")}<input name="givenName" required/></label><label>{c("Last name","Soyad")}<input name="familyName" required/></label></div>
        <label>E-mail<input name="email" type="email" required/></label>
        <div className="ats-form-row"><label>{c("Phone","Telefon")}<input name="phone"/></label><label>{c("Source","Kaynak")}<input name="source" placeholder="LinkedIn / Referral"/></label></div>
        <label>{c("Open requisition","Açık işe alım talebi")}<select name="requisitionId" required defaultValue=""><option value="" disabled>{c("Select requisition","Talep seçin")}</option>{openRequisitions.map((requisition) => <option key={requisition.id} value={requisition.id}>{requisition.title} · {requisition.position}</option>)}</select></label>
        <label>{c("Retention until","Saklama bitişi")}<input name="retentionUntil" type="date"/></label>
        <button className="create-button" disabled={pending !== null || !openRequisitions.length}>{pending === "candidate" ? c("Adding…","Ekleniyor…") : c("Create candidate application","Aday başvurusu oluştur")}</button>
      </form>
    </div>

    <div className="ats-ops-grid">
      <div className="ats-ops-panel">
        <div className="ats-panel-title"><UsersRound size={16}/><div><strong>{c("Application lifecycle","Başvuru yaşam döngüsü")}</strong><small>{applications.length} {c("active applications","aktif başvuru")}</small></div></div>
        <div className="ats-operation-list">{applications.length ? applications.map((application) => <ApplicationOperation key={application.id} application={application} pending={pending} post={post} canApprove={canApprove}/>) : <p className="ats-empty">{c("No active applications.","Aktif başvuru yok.")}</p>}</div>
      </div>

      <div className="ats-ops-panel">
        <div className="ats-panel-title"><FileCheck2 size={16}/><div><strong>{c("Requisition approvals","İşe alım talebi onayları")}</strong><small>{requisitions.length} {c("governed requisitions","yönetişimli talep")}</small></div></div>
        <div className="ats-operation-list">{requisitions.map((requisition) => {
          const transitions = requisition.status === "APPROVAL" && !canApprove ? [] : (requisitionTransitions[requisition.status] ?? []);
          return <div className="ats-operation" key={requisition.id}><div className="ats-operation-main"><strong>{requisition.title}</strong><small>{requisition.position}</small><em className={`pill ${requisition.status.toLowerCase().replaceAll("_", "-")}`}>{label(requisition.status,locale)}</em></div><div className="ats-actions">{transitions.map((next) => <button type="button" key={next} disabled={pending !== null} onClick={() => void post(`req-${requisition.id}-${next}`, `/api/recruiting/requisitions/${requisition.id}/status`, { status: next })}>{pending === `req-${requisition.id}-${next}` ? "…" : label(next,locale)}</button>)}{requisition.status === "APPROVAL" && !canApprove ? <small>{c("Independent approver required","Bağımsız onaylayıcı gerekli")}</small> : null}</div></div>;
        })}</div>
      </div>
    </div>
  </section>;
}

function ApplicationOperation({ application, pending, post, canApprove }: { application: ApplicationOperation; pending: string | null; post: (key: string, url: string, payload: Record<string, unknown>) => Promise<boolean>; canApprove: boolean }) {
  const { locale } = useLocale();
  const c = (en:string,tr:string) => locale === "tr" ? tr : en;
  const [offerOpen, setOfferOpen] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);
  const canCreateOffer = !application.offer && ["INTERVIEW", "ASSESSMENT", "OFFER"].includes(application.stage);

  return <div className="ats-operation">
    <div className="ats-operation-main"><strong>{application.candidate}</strong><small>{application.requisition}</small><div className="ats-state-line"><em className={`pill ${application.stage.toLowerCase()}`}>{label(application.stage,locale)}</em>{application.offer ? <em className={`pill ${application.offer.status.toLowerCase()}`}>{c("Offer","Teklif")} · {label(application.offer.status,locale)}</em> : null}</div></div>
    <div className="ats-actions">{(applicationTransitions[application.stage] ?? []).map((next) => <button type="button" key={next} disabled={pending !== null} onClick={() => void post(`app-${application.id}-${next}`, `/api/recruiting/applications/${application.id}/stage`, { stage: next })}>{pending === `app-${application.id}-${next}` ? "…" : label(next,locale)}</button>)}{canCreateOffer ? <button type="button" className="primary-mini" onClick={() => setOfferOpen((value) => !value)}>{c("Create offer","Teklif oluştur")}</button> : null}</div>

    {offerOpen ? <form className="ats-inline-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void post(`offer-${application.id}`, `/api/recruiting/applications/${application.id}/offer`, { currency: data.get("currency"), annualBase: Number(data.get("annualBase")), startDate: data.get("startDate"), expiresAt: data.get("expiresAt") || null }).then((ok) => { if (ok) setOfferOpen(false); }); }}><input name="currency" defaultValue="EUR" maxLength={3} required/><input name="annualBase" type="number" min="1" placeholder={c("Annual base","Yıllık baz ücret")} required/><input name="startDate" type="date" required/><input name="expiresAt" type="date"/><button disabled={pending !== null}>{c("Save offer","Teklifi kaydet")}</button></form> : null}

    {application.offer ? <div className="ats-offer-line"><span>{application.offer.currency} {Number(application.offer.annualBase).toLocaleString(locale === "tr" ? "tr-TR" : "en-US")} · {c("Start","Başlangıç")} {new Date(application.offer.startDate).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB")}</span><div className="ats-actions">{(application.offer.status === "APPROVAL" && !canApprove ? [] : (offerTransitions[application.offer.status] ?? [])).map((next) => <button type="button" key={next} disabled={pending !== null} onClick={() => void post(`offer-status-${application.offer?.id}-${next}`, `/api/recruiting/offers/${application.offer?.id}/status`, { status: next })}>{label(next,locale)}</button>)}{application.offer.status === "APPROVAL" && !canApprove ? <small>{c("Independent approver required","Bağımsız onaylayıcı gerekli")}</small> : null}{application.offer.status === "ACCEPTED" ? <button type="button" className="primary-mini" onClick={() => setHireOpen((value) => !value)}>{c("Convert to employee","Çalışana dönüştür")}</button> : null}</div></div> : null}

    {hireOpen ? <form className="ats-inline-form hire" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void post(`hire-${application.id}`, "/api/recruiting/hire", { applicationId: application.id, employeeNumber: data.get("employeeNumber"), workEmail: data.get("workEmail") }).then((ok) => { if (ok) setHireOpen(false); }); }}><input name="employeeNumber" placeholder={c("Employee no","Çalışan no")} required/><input name="workEmail" type="email" placeholder={c("Work email","İş e-postası")}/><button disabled={pending !== null}>{c("Hire & start onboarding","İşe al & işe başlatmayı başlat")}</button></form> : null}
  </div>;
}
