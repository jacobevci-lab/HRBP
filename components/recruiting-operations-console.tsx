"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, CheckCircle2, CircleAlert, FileCheck2, LocateFixed, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
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
type ApprovalQueueItem = {
  type: "REQUISITION" | "OFFER";
  id: string;
  title: string;
  subtitle: string;
  preparedBy: string;
  selfPrepared: boolean;
  submittedAt: string;
};
type DeepLinkTarget = { type: "requisition" | "offer" | "candidate" | "application"; id: string };
type CandidateLookup = { id: string; applications?: Array<{ id: string; offer?: { id: string } | null }> };

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

const offerLocksApplication = new Set(["APPROVAL", "SENT", "ACCEPTED"]);

function label(value: string, locale: "en" | "tr") {
  if (locale === "tr") {
    const labels: Record<string,string> = {
      EMPLOYEE:"Çalışan", MANAGER:"Yönetici", HRBP:"İK İş Ortağı", HR_OPERATIONS:"İK Operasyonları", TENANT_ADMIN:"Tenant Yöneticisi",
      REQUISITION:"İşe alım talebi", CANDIDATE:"Aday", APPLICATION:"Başvuru",
      DRAFT:"Taslak", APPROVAL:"Onay", OPEN:"Açık", ON_HOLD:"Beklemede", CLOSED:"Kapalı", CANCELLED:"İptal",
      APPLIED:"Başvurdu", SCREENING:"Ön Eleme", INTERVIEW:"Mülakat", ASSESSMENT:"Değerlendirme", OFFER:"Teklif", HIRED:"İşe Alındı", REJECTED:"Reddedildi", WITHDRAWN:"Geri Çekildi",
      SENT:"Gönderildi", ACCEPTED:"Kabul Edildi", DECLINED:"Reddedildi", EXPIRED:"Süresi Doldu"
    };
    if (labels[value]) return labels[value];
  }
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function deepLinkTargetFromLocation(): DeepLinkTarget | null {
  if (typeof window === "undefined") return null;
  const search = new URLSearchParams(window.location.search);
  for (const type of ["requisition", "offer", "candidate", "application"] as const) {
    const id = search.get(type)?.trim();
    if (id) return { type, id };
  }
  return null;
}

function matchingNode(type: "requisition" | "offer" | "application", id: string) {
  const attribute = `data-recruiting-${type}`;
  return [...document.querySelectorAll<HTMLElement>(`[${attribute}]`)].find((element) => element.getAttribute(attribute) === id) ?? null;
}

export function RecruitingOperationsConsole({ positions, users, requisitions, applications, canApprove }: Props) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en:string,tr:string) => locale === "tr" ? tr : en;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [approvalQueue, setApprovalQueue] = useState<ApprovalQueueItem[]>([]);
  const [approvalLoading, setApprovalLoading] = useState(true);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvalRefreshToken, setApprovalRefreshToken] = useState(0);
  const [deepLinkTarget, setDeepLinkTarget] = useState<DeepLinkTarget | null>(null);
  const [resolvedApplicationId, setResolvedApplicationId] = useState<string | null>(null);
  const [deepLinkFound, setDeepLinkFound] = useState<boolean | null>(null);
  const openRequisitions = useMemo(() => requisitions.filter((requisition) => requisition.status === "OPEN"), [requisitions]);

  useEffect(() => {
    setDeepLinkTarget(deepLinkTargetFromLocation());
  }, []);

  useEffect(() => {
    if (!deepLinkTarget || (deepLinkTarget.type !== "candidate" && deepLinkTarget.type !== "offer")) return;
    let cancelled = false;
    void fetch("/api/recruiting/candidates", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return [] as CandidateLookup[];
        const body = await response.json().catch(() => ({})) as { data?: CandidateLookup[] };
        return body.data ?? [];
      })
      .then((candidates) => {
        if (cancelled) return;
        if (deepLinkTarget.type === "candidate") {
          const candidate = candidates.find((item) => item.id === deepLinkTarget.id);
          setResolvedApplicationId(candidate?.applications?.[0]?.id ?? null);
          return;
        }
        const application = candidates.flatMap((candidate) => candidate.applications ?? []).find((item) => item.offer?.id === deepLinkTarget.id);
        setResolvedApplicationId(application?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setResolvedApplicationId(null);
      });
    return () => { cancelled = true; };
  }, [deepLinkTarget]);

  useEffect(() => {
    if (!deepLinkTarget) return;
    let targetType: "requisition" | "offer" | "application" | null = deepLinkTarget.type === "candidate" ? null : deepLinkTarget.type;
    let targetId = deepLinkTarget.id;

    if ((deepLinkTarget.type === "candidate" || deepLinkTarget.type === "offer") && resolvedApplicationId) {
      const direct = deepLinkTarget.type === "offer" ? matchingNode("offer", deepLinkTarget.id) : null;
      if (direct) {
        targetType = "offer";
        targetId = deepLinkTarget.id;
      } else {
        targetType = "application";
        targetId = resolvedApplicationId;
      }
    }

    if (!targetType) {
      setDeepLinkFound(resolvedApplicationId === null ? false : null);
      return;
    }

    const node = matchingNode(targetType, targetId);
    if (!node) {
      if (!approvalLoading) setDeepLinkFound(false);
      return;
    }

    const previous = {
      outline: node.style.outline,
      outlineOffset: node.style.outlineOffset,
      background: node.style.background,
      scrollMarginTop: node.style.scrollMarginTop
    };
    node.style.outline = "2px solid var(--orange)";
    node.style.outlineOffset = "3px";
    node.style.background = "var(--accent-soft)";
    node.style.scrollMarginTop = "120px";
    setDeepLinkFound(true);
    window.requestAnimationFrame(() => node.scrollIntoView({ behavior: "smooth", block: "center" }));

    return () => {
      node.style.outline = previous.outline;
      node.style.outlineOffset = previous.outlineOffset;
      node.style.background = previous.background;
      node.style.scrollMarginTop = previous.scrollMarginTop;
    };
  }, [deepLinkTarget, resolvedApplicationId, approvalQueue, approvalLoading, applications, requisitions]);

  useEffect(() => {
    let cancelled = false;
    setApprovalLoading(true);
    setApprovalError(null);
    void fetch("/api/recruiting/approvals", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { data?: { items?: ApprovalQueueItem[] }; error?: string };
        if (!response.ok) throw new Error(body.error || `Approval queue failed (${response.status})`);
        if (!cancelled) setApprovalQueue(body.data?.items ?? []);
      })
      .catch((error) => {
        if (!cancelled) setApprovalError(error instanceof Error ? error.message : c("Approval queue could not be loaded.","Onay kuyruğu yüklenemedi."));
      })
      .finally(() => {
        if (!cancelled) setApprovalLoading(false);
      });
    return () => { cancelled = true; };
  }, [approvalRefreshToken, locale]);

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
      setApprovalRefreshToken((value) => value + 1);
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

  function approvalActions(item: ApprovalQueueItem) {
    if (item.selfPrepared) return <small>{c("Prepared by you · four-eyes control requires another approver","Sizin tarafınızdan hazırlandı · dört-göz kontrolü başka bir onaylayıcı gerektirir")}</small>;
    if (!canApprove) return <small>{c("Independent approver required","Bağımsız onaylayıcı gerekli")}</small>;
    if (item.type === "REQUISITION") {
      return <>
        <button type="button" className="primary-mini" disabled={pending !== null} onClick={() => void post(`approval-${item.id}-OPEN`, `/api/recruiting/requisitions/${item.id}/status`, { status: "OPEN" })}>{pending === `approval-${item.id}-OPEN` ? "…" : c("Approve & open","Onayla & aç")}</button>
        <button type="button" disabled={pending !== null} onClick={() => void post(`approval-${item.id}-DRAFT`, `/api/recruiting/requisitions/${item.id}/status`, { status: "DRAFT" })}>{c("Return","Geri gönder")}</button>
        <button type="button" disabled={pending !== null} onClick={() => void post(`approval-${item.id}-CANCELLED`, `/api/recruiting/requisitions/${item.id}/status`, { status: "CANCELLED" })}>{c("Cancel","İptal")}</button>
      </>;
    }
    return <>
      <button type="button" className="primary-mini" disabled={pending !== null} onClick={() => void post(`approval-${item.id}-SENT`, `/api/recruiting/offers/${item.id}/status`, { status: "SENT" })}>{pending === `approval-${item.id}-SENT` ? "…" : c("Approve & send","Onayla & gönder")}</button>
      <button type="button" disabled={pending !== null} onClick={() => void post(`approval-${item.id}-DRAFT`, `/api/recruiting/offers/${item.id}/status`, { status: "DRAFT" })}>{c("Return","Geri gönder")}</button>
      <button type="button" disabled={pending !== null} onClick={() => void post(`approval-${item.id}-WITHDRAWN`, `/api/recruiting/offers/${item.id}/status`, { status: "WITHDRAWN" })}>{c("Withdraw","Geri çek")}</button>
    </>;
  }

  return <section className="ats-console card">
    <div className="ats-console-head">
      <div><span className="section-kicker">{c("Governed ATS transactions","Yönetişimli ATS işlemleri")}</span><h3>{c("Recruiting operations console","İşe alım operasyon konsolu")}</h3><p>{c("Preparation and independent approval are separated. Every mutation is tenant-scoped, state-validated and audit logged. Hire conversion creates the employee, employment, lifecycle event and onboarding plan in one serializable transaction.","Hazırlama ve bağımsız onay ayrılmıştır. Her değişiklik tenant kapsamlıdır, durum doğrulamasından geçer ve denetim kaydı üretir. İşe alım dönüşümü çalışanı, istihdamı, yaşam döngüsü olayını ve işe başlatma planını tek serializable işlemde oluşturur.")}</p></div>
      <div className="ats-console-health"><CheckCircle2 size={16}/><span>{canApprove ? c("Write + approval controls active","Yazma + onay kontrolleri aktif") : c("Preparation controls active","Hazırlama kontrolleri aktif")}</span></div>
    </div>

    {deepLinkTarget ? <div className={`ats-notice ${deepLinkFound === false ? "error" : "ok"}`}><span>{deepLinkFound === false ? <CircleAlert size={15}/> : <LocateFixed size={15}/>}</span><div><strong>{c("Notification context","Bildirim bağlamı")}: {label(deepLinkTarget.type.toUpperCase(),locale)} · {deepLinkTarget.id}</strong><small style={{ display:"block", marginTop:3 }}>{deepLinkFound === true ? c("The linked record is highlighted below.","Bağlantılı kayıt aşağıda vurgulandı.") : deepLinkFound === false ? c("The linked record is not in the current active workspace. It may have moved to a terminal or historical state.","Bağlantılı kayıt aktif çalışma alanında görünmüyor. Terminal veya geçmiş duruma taşınmış olabilir.") : c("Locating the linked governed record…","Bağlantılı yönetişimli kayıt bulunuyor…")}</small></div></div> : null}
    {notice ? <div className={`ats-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}

    <div className="ats-ops-panel" style={{ marginBottom: 16 }}>
      <div className="ats-panel-title"><ShieldCheck size={16}/><div><strong>{c("Approval queue","Onay kuyruğu")}</strong><small>{approvalLoading ? c("Loading governed decisions…","Yönetişimli kararlar yükleniyor…") : `${approvalQueue.length} ${c("records awaiting independent decision","kayıt bağımsız karar bekliyor")}`}</small></div></div>
      {approvalError ? <div className="ats-notice error"><span><CircleAlert size={15}/></span>{approvalError}</div> : null}
      <div className="ats-operation-list">
        {!approvalLoading && !approvalQueue.length && !approvalError ? <p className="ats-empty">{c("No recruiting approvals are waiting.","Bekleyen işe alım onayı yok.")}</p> : null}
        {approvalQueue.map((item) => <div className="ats-operation" key={`${item.type}-${item.id}`} data-recruiting-requisition={item.type === "REQUISITION" ? item.id : undefined} data-recruiting-offer={item.type === "OFFER" ? item.id : undefined}>
          <div className="ats-operation-main">
            <strong>{item.title}</strong>
            <small>{item.subtitle}</small>
            <small>{c("Prepared by","Hazırlayan")}: {item.preparedBy} · {new Date(item.submittedAt).toLocaleString(locale === "tr" ? "tr-TR" : "en-GB")}</small>
            <div className="ats-state-line"><em className="pill approval">{label(item.type,locale)} · {label("APPROVAL",locale)}</em>{item.selfPrepared ? <em className="pill on-hold">{c("Four-eyes lock","Dört-göz kilidi")}</em> : null}</div>
          </div>
          <div className="ats-actions">{approvalActions(item)}</div>
        </div>)}
      </div>
    </div>

    <div className="ats-create-grid">
      <form className="ats-form" onSubmit={(event) => { event.preventDefault(); void submitRequisition(event.currentTarget); }}>
        <div className="ats-form-title"><BriefcaseBusiness size={17}/><div><strong>{c("New requisition","Yeni işe alım talebi")}</strong><small>{c("One governed position = one authorized opening","Bir yönetişimli pozisyon = bir yetkili kadro")}</small></div></div>
        <label>{c("Title","Başlık")}<input name="title" required placeholder="Senior Security Engineer"/></label>
        <div className="ats-form-row"><label>{c("Position","Pozisyon")}<select name="positionId" defaultValue=""><option value="">{c("Unassigned","Atanmamış")}</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.code} · {position.title} · {position.organization}</option>)}</select></label><label>{c("Openings","Açık kadro")}<input name="openings" type="number" min="1" max="1" defaultValue="1" required/></label></div>
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
        <div className="ats-operation-list">{applications.length ? applications.map((application) => <ApplicationOperation key={application.id} application={application} pending={pending} post={post}/>) : <p className="ats-empty">{c("No active applications.","Aktif başvuru yok.")}</p>}</div>
      </div>

      <div className="ats-ops-panel">
        <div className="ats-panel-title"><FileCheck2 size={16}/><div><strong>{c("Requisition lifecycle","İşe alım talebi yaşam döngüsü")}</strong><small>{requisitions.length} {c("governed requisitions","yönetişimli talep")}</small></div></div>
        <div className="ats-operation-list">{requisitions.map((requisition) => {
          const transitions = requisition.status === "APPROVAL" ? [] : (requisitionTransitions[requisition.status] ?? []);
          return <div className="ats-operation" key={requisition.id} data-recruiting-requisition={requisition.id}><div className="ats-operation-main"><strong>{requisition.title}</strong><small>{requisition.position}</small><em className={`pill ${requisition.status.toLowerCase().replaceAll("_", "-")}`}>{label(requisition.status,locale)}</em></div><div className="ats-actions">{transitions.map((next) => <button type="button" key={next} disabled={pending !== null} onClick={() => void post(`req-${requisition.id}-${next}`, `/api/recruiting/requisitions/${requisition.id}/status`, { status: next })}>{pending === `req-${requisition.id}-${next}` ? "…" : label(next,locale)}</button>)}{requisition.status === "APPROVAL" ? <small>{canApprove ? c("Decision available in approval queue","Karar onay kuyruğunda") : c("Independent approver required","Bağımsız onaylayıcı gerekli")}</small> : null}</div></div>;
        })}</div>
      </div>
    </div>
  </section>;
}

function ApplicationOperation({ application, pending, post }: { application: ApplicationOperation; pending: string | null; post: (key: string, url: string, payload: Record<string, unknown>) => Promise<boolean> }) {
  const { locale } = useLocale();
  const c = (en:string,tr:string) => locale === "tr" ? tr : en;
  const [offerOpen, setOfferOpen] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);
  const canCreateOffer = !application.offer && ["INTERVIEW", "ASSESSMENT", "OFFER"].includes(application.stage);
  const applicationLockedByOffer = Boolean(application.offer && offerLocksApplication.has(application.offer.status));
  const applicationActions = applicationLockedByOffer ? [] : (applicationTransitions[application.stage] ?? []);

  return <div className="ats-operation" data-recruiting-application={application.id}>
    <div className="ats-operation-main"><strong>{application.candidate}</strong><small>{application.requisition}</small><div className="ats-state-line"><em className={`pill ${application.stage.toLowerCase()}`}>{label(application.stage,locale)}</em>{application.offer ? <em className={`pill ${application.offer.status.toLowerCase()}`}>{c("Offer","Teklif")} · {label(application.offer.status,locale)}</em> : null}</div></div>
    <div className="ats-actions">{applicationActions.map((next) => <button type="button" key={next} disabled={pending !== null} onClick={() => void post(`app-${application.id}-${next}`, `/api/recruiting/applications/${application.id}/stage`, { stage: next })}>{pending === `app-${application.id}-${next}` ? "…" : label(next,locale)}</button>)}{applicationLockedByOffer ? <small>{c("Offer lifecycle controls this application","Teklif yaşam döngüsü bu başvuruyu kontrol ediyor")}</small> : null}{canCreateOffer ? <button type="button" className="primary-mini" onClick={() => setOfferOpen((value) => !value)}>{c("Create offer","Teklif oluştur")}</button> : null}</div>

    {offerOpen ? <form className="ats-inline-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void post(`offer-${application.id}`, `/api/recruiting/applications/${application.id}/offer`, { currency: data.get("currency"), annualBase: Number(data.get("annualBase")), startDate: data.get("startDate"), expiresAt: data.get("expiresAt") || null }).then((ok) => { if (ok) setOfferOpen(false); }); }}><input name="currency" defaultValue="EUR" maxLength={3} required/><input name="annualBase" type="number" min="1" placeholder={c("Annual base","Yıllık baz ücret")} required/><input name="startDate" type="date" required/><input name="expiresAt" type="date"/><button disabled={pending !== null}>{c("Save offer","Teklifi kaydet")}</button></form> : null}

    {application.offer ? <div className="ats-offer-line" data-recruiting-offer={application.offer.id}><span>{application.offer.currency} {Number(application.offer.annualBase).toLocaleString(locale === "tr" ? "tr-TR" : "en-US")} · {c("Start","Başlangıç")} {new Date(application.offer.startDate).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB")}{application.offer.expiresAt ? ` · ${c("Expires","Bitiş")} ${new Date(application.offer.expiresAt).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB")}` : ""}</span><div className="ats-actions">{(application.offer.status === "APPROVAL" ? [] : (offerTransitions[application.offer.status] ?? [])).map((next) => <button type="button" key={next} disabled={pending !== null} onClick={() => void post(`offer-status-${application.offer?.id}-${next}`, `/api/recruiting/offers/${application.offer?.id}/status`, { status: next })}>{label(next,locale)}</button>)}{application.offer.status === "APPROVAL" ? <small>{c("Decision available in approval queue","Karar onay kuyruğunda")}</small> : null}{application.offer.status === "ACCEPTED" ? <button type="button" className="primary-mini" onClick={() => setHireOpen((value) => !value)}>{c("Convert to employee","Çalışana dönüştür")}</button> : null}</div></div> : null}

    {hireOpen ? <form className="ats-inline-form hire" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void post(`hire-${application.id}`, "/api/recruiting/hire", { applicationId: application.id, employeeNumber: data.get("employeeNumber"), workEmail: data.get("workEmail") }).then((ok) => { if (ok) setHireOpen(false); }); }}><input name="employeeNumber" maxLength={64} placeholder={c("Employee no","Çalışan no")} required/><input name="workEmail" type="email" placeholder={c("Work email","İş e-postası")}/><button disabled={pending !== null}>{c("Hire & start onboarding","İşe al & işe başlatmayı başlat")}</button></form> : null}
  </div>;
}
