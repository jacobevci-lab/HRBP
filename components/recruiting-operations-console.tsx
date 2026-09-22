"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, CheckCircle2, CircleAlert, FileCheck2, UserPlus, UsersRound } from "lucide-react";

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

function label(value: string) {
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export function RecruitingOperationsConsole({ positions, users, requisitions, applications }: Props) {
  const router = useRouter();
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
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
      setNotice({ tone: "ok", text: "Transaction completed and written to the governed HR record." });
      router.refresh();
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Transaction failed." });
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
      <div><span className="section-kicker">Governed ATS transactions</span><h3>Recruiting operations console</h3><p>Every mutation is tenant-scoped, state-validated and audit logged. Hire conversion creates the employee, employment, lifecycle event and onboarding plan in one transaction.</p></div>
      <div className="ats-console-health"><CheckCircle2 size={16}/><span>Write controls active</span></div>
    </div>

    {notice ? <div className={`ats-notice ${notice.tone}`}><span>{notice.tone === "ok" ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span>{notice.text}</div> : null}

    <div className="ats-create-grid">
      <form className="ats-form" onSubmit={(event) => { event.preventDefault(); void submitRequisition(event.currentTarget); }}>
        <div className="ats-form-title"><BriefcaseBusiness size={17}/><div><strong>New requisition</strong><small>Position-backed hiring demand</small></div></div>
        <label>Title<input name="title" required placeholder="Senior Security Engineer"/></label>
        <div className="ats-form-row"><label>Position<select name="positionId" defaultValue=""><option value="">Unassigned</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.code} · {position.title} · {position.organization}</option>)}</select></label><label>Openings<input name="openings" type="number" min="1" defaultValue="1" required/></label></div>
        <div className="ats-form-row"><label>Hiring manager<select name="hiringManagerId" defaultValue=""><option value="">Not assigned</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {label(user.role)}</option>)}</select></label><label>Recruiter<select name="recruiterId" defaultValue=""><option value="">Not assigned</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {label(user.role)}</option>)}</select></label></div>
        <label>Target hire date<input name="targetHireDate" type="date"/></label>
        <button className="create-button" disabled={pending !== null}>{pending === "requisition" ? "Creating…" : "Create draft requisition"}</button>
      </form>

      <form className="ats-form" onSubmit={(event) => { event.preventDefault(); void submitCandidate(event.currentTarget); }}>
        <div className="ats-form-title"><UserPlus size={17}/><div><strong>Add candidate</strong><small>Restricted candidate master + application</small></div></div>
        <div className="ats-form-row"><label>First name<input name="givenName" required/></label><label>Last name<input name="familyName" required/></label></div>
        <label>Email<input name="email" type="email" required/></label>
        <div className="ats-form-row"><label>Phone<input name="phone"/></label><label>Source<input name="source" placeholder="LinkedIn / Referral"/></label></div>
        <label>Open requisition<select name="requisitionId" required defaultValue=""><option value="" disabled>Select requisition</option>{openRequisitions.map((requisition) => <option key={requisition.id} value={requisition.id}>{requisition.title} · {requisition.position}</option>)}</select></label>
        <label>Retention until<input name="retentionUntil" type="date"/></label>
        <button className="create-button" disabled={pending !== null || !openRequisitions.length}>{pending === "candidate" ? "Adding…" : "Create candidate application"}</button>
      </form>
    </div>

    <div className="ats-ops-grid">
      <div className="ats-ops-panel">
        <div className="ats-panel-title"><UsersRound size={16}/><div><strong>Application lifecycle</strong><small>{applications.length} active applications</small></div></div>
        <div className="ats-operation-list">{applications.length ? applications.map((application) => <ApplicationOperation key={application.id} application={application} pending={pending} post={post}/>) : <p className="ats-empty">No active applications.</p>}</div>
      </div>

      <div className="ats-ops-panel">
        <div className="ats-panel-title"><FileCheck2 size={16}/><div><strong>Requisition approvals</strong><small>{requisitions.length} governed requisitions</small></div></div>
        <div className="ats-operation-list">{requisitions.map((requisition) => <div className="ats-operation" key={requisition.id}><div className="ats-operation-main"><strong>{requisition.title}</strong><small>{requisition.position}</small><em className={`pill ${requisition.status.toLowerCase().replaceAll("_", "-")}`}>{label(requisition.status)}</em></div><div className="ats-actions">{(requisitionTransitions[requisition.status] ?? []).map((next) => <button type="button" key={next} disabled={pending !== null} onClick={() => void post(`req-${requisition.id}-${next}`, `/api/recruiting/requisitions/${requisition.id}/status`, { status: next })}>{pending === `req-${requisition.id}-${next}` ? "…" : label(next)}</button>)}</div></div>)}</div>
      </div>
    </div>
  </section>;
}

function ApplicationOperation({ application, pending, post }: { application: ApplicationOperation; pending: string | null; post: (key: string, url: string, payload: Record<string, unknown>) => Promise<boolean> }) {
  const [offerOpen, setOfferOpen] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);
  const canCreateOffer = !application.offer && ["INTERVIEW", "ASSESSMENT", "OFFER"].includes(application.stage);

  return <div className="ats-operation">
    <div className="ats-operation-main"><strong>{application.candidate}</strong><small>{application.requisition}</small><div className="ats-state-line"><em className={`pill ${application.stage.toLowerCase()}`}>{label(application.stage)}</em>{application.offer ? <em className={`pill ${application.offer.status.toLowerCase()}`}>Offer · {label(application.offer.status)}</em> : null}</div></div>
    <div className="ats-actions">{(applicationTransitions[application.stage] ?? []).map((next) => <button type="button" key={next} disabled={pending !== null} onClick={() => void post(`app-${application.id}-${next}`, `/api/recruiting/applications/${application.id}/stage`, { stage: next })}>{pending === `app-${application.id}-${next}` ? "…" : label(next)}</button>)}{canCreateOffer ? <button type="button" className="primary-mini" onClick={() => setOfferOpen((value) => !value)}>Create offer</button> : null}</div>

    {offerOpen ? <form className="ats-inline-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void post(`offer-${application.id}`, `/api/recruiting/applications/${application.id}/offer`, { currency: data.get("currency"), annualBase: Number(data.get("annualBase")), startDate: data.get("startDate"), expiresAt: data.get("expiresAt") || null }).then((ok) => { if (ok) setOfferOpen(false); }); }}><input name="currency" defaultValue="EUR" maxLength={3} required/><input name="annualBase" type="number" min="1" placeholder="Annual base" required/><input name="startDate" type="date" required/><input name="expiresAt" type="date"/><button disabled={pending !== null}>Save offer</button></form> : null}

    {application.offer ? <div className="ats-offer-line"><span>{application.offer.currency} {Number(application.offer.annualBase).toLocaleString()} · Start {new Date(application.offer.startDate).toLocaleDateString()}</span><div className="ats-actions">{(offerTransitions[application.offer.status] ?? []).map((next) => <button type="button" key={next} disabled={pending !== null} onClick={() => void post(`offer-status-${application.offer?.id}-${next}`, `/api/recruiting/offers/${application.offer?.id}/status`, { status: next })}>{label(next)}</button>)}{application.offer.status === "ACCEPTED" ? <button type="button" className="primary-mini" onClick={() => setHireOpen((value) => !value)}>Convert to employee</button> : null}</div></div> : null}

    {hireOpen ? <form className="ats-inline-form hire" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void post(`hire-${application.id}`, "/api/recruiting/hire", { applicationId: application.id, employeeNumber: data.get("employeeNumber"), workEmail: data.get("workEmail") }).then((ok) => { if (ok) setHireOpen(false); }); }}><input name="employeeNumber" placeholder="Employee no" required/><input name="workEmail" type="email" placeholder="Work email"/><button disabled={pending !== null}>Hire & start onboarding</button></form> : null}
  </div>;
}
