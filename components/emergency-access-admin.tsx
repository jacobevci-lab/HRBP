"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Clock3, ShieldAlert, X } from "lucide-react";
import { useLocale } from "@/components/locale-provider";

type UserRef = { id: string; displayName: string; email: string | null } | null;
type EmergencyRow = {
  id: string;
  requesterId: string;
  reason: string;
  requestedMinutes: number;
  status: "REQUESTED" | "ACTIVE" | "REJECTED" | "REVOKED" | "EXPIRED";
  requestedAt: string;
  decidedById: string | null;
  decidedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  revokedById: string | null;
  revokedAt: string | null;
  decisionNote: string | null;
  requester: UserRef;
  decidedBy: UserRef;
  revokedBy: UserRef;
  effectiveActive: boolean;
};

type Payload = {
  data: EmergencyRow[];
  policy: { enabled: boolean };
  permissions: { request: boolean; decide: boolean; revoke: boolean };
  currentActorId: string;
};

export function EmergencyAccessAdmin() {
  const { locale } = useLocale();
  const c = useCallback((en: string, tr: string) => locale === "tr" ? tr : en, [locale]);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/settings/emergency-access", { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as Partial<Payload> & { error?: string };
    if (!response.ok || !body.data || !body.permissions || !body.policy || !body.currentActorId) {
      throw new Error(body.error || c("Emergency access data could not be loaded.", "Acil erişim verisi yüklenemedi."));
    }
    setPayload(body as Payload);
  }, [c]);

  useEffect(() => {
    load().catch((error) => setMessage({
      kind: "error",
      text: error instanceof Error ? error.message : c("Emergency access data could not be loaded.", "Acil erişim verisi yüklenemedi.")
    }));
  }, [load, c]);

  const pendingForActor = useMemo(
    () => payload?.data.find((row) => row.requesterId === payload.currentActorId && ["REQUESTED", "ACTIVE"].includes(row.status)) ?? null,
    [payload]
  );

  async function requestAccess() {
    if (!payload?.permissions.request || busy) return;
    setBusy("request");
    setMessage(null);
    try {
      const response = await fetch("/api/settings/emergency-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason, requestedMinutes: minutes })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c("Emergency access request failed.", "Acil erişim talebi başarısız."));
      setReason("");
      setMessage({ kind: "ok", text: c("Emergency access request created for independent approval.", "Acil erişim talebi bağımsız onay için oluşturuldu.") });
      await load();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : c("Emergency access request failed.", "Acil erişim talebi başarısız.") });
    } finally {
      setBusy(null);
    }
  }

  async function decide(id: string, decision: "APPROVE" | "REJECT") {
    if (!payload?.permissions.decide || busy) return;
    setBusy(id + ":" + decision);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/emergency-access/" + encodeURIComponent(id) + "/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c("Emergency access decision failed.", "Acil erişim kararı başarısız."));
      setMessage({
        kind: "ok",
        text: decision === "APPROVE"
          ? c("Emergency access approved and time-bounded.", "Acil erişim onaylandı ve süreyle sınırlandı.")
          : c("Emergency access request rejected.", "Acil erişim talebi reddedildi.")
      });
      await load();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : c("Emergency access decision failed.", "Acil erişim kararı başarısız.") });
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    if (!payload?.permissions.revoke || busy) return;
    setBusy(id + ":revoke");
    setMessage(null);
    try {
      const response = await fetch("/api/settings/emergency-access/" + encodeURIComponent(id), { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || c("Emergency access revocation failed.", "Acil erişim geri alma işlemi başarısız."));
      setMessage({ kind: "ok", text: c("Emergency access revoked immediately.", "Acil erişim anında geri alındı.") });
      await load();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : c("Emergency access revocation failed.", "Acil erişim geri alma işlemi başarısız.") });
    } finally {
      setBusy(null);
    }
  }

  const dateLocale = locale === "tr" ? "tr-TR" : "en-GB";
  return <section className="card platform-panel">
    <div className="platform-head">
      <div>
        <span className="section-kicker">{c("Emergency access", "Acil erişim")}</span>
        <h3>{c("Four-eyes break-glass access", "Dört göz kontrollü break-glass erişimi")}</h3>
        <p>{c(
          "Read-only access to highly restricted data is available only after a second tenant administrator approves a short-lived MFA-assured request.",
          "Highly restricted verilere salt-okunur erişim yalnızca ikinci bir tenant yöneticisi MFA kanıtlı ve kısa süreli talebi onayladıktan sonra kullanılabilir."
        )}</p>
      </div>
      <ShieldAlert size={20}/>
    </div>

    {!payload?.policy.enabled ? <div className="settings-policy-warning"><AlertTriangle size={15}/><span>{c(
      "Break-glass access is disabled by tenant security policy.",
      "Break-glass erişimi tenant güvenlik politikası tarafından devre dışı."
    )}</span></div> : null}

    {message ? <div className={"settings-policy-message " + message.kind}>{message.text}</div> : null}

    {payload?.permissions.request && payload.policy.enabled && !pendingForActor ? <div className="settings-policy-fields">
      <label>{c("Business justification", "İş gerekçesi")}
        <input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder={c("Incident / legal / recovery reason", "Olay / hukuk / kurtarma gerekçesi")}/>
      </label>
      <label>{c("Requested minutes", "Talep edilen dakika")}
        <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
          {[15, 30, 45, 60].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <button className="create-button" type="button" disabled={Boolean(busy) || reason.trim().length < 20} onClick={() => void requestAccess()}>
        <Clock3 size={15}/>{busy === "request" ? c("Requesting…", "Talep ediliyor…") : c("Request emergency access", "Acil erişim talep et")}
      </button>
    </div> : null}

    <div className="platform-table-wrap">
      <table className="platform-table compact">
        <thead><tr>
          <th>{c("Requester", "Talep eden")}</th>
          <th>{c("Reason", "Gerekçe")}</th>
          <th>{c("Duration", "Süre")}</th>
          <th>{c("Status", "Durum")}</th>
          <th>{c("Valid until", "Geçerli olduğu zaman")}</th>
          <th>{c("Actions", "İşlemler")}</th>
        </tr></thead>
        <tbody>
          {payload?.data.length ? payload.data.map((row) => {
            const own = row.requesterId === payload.currentActorId;
            const canDecide = payload.permissions.decide && row.status === "REQUESTED" && !own;
            const canRevoke = payload.permissions.revoke && ["REQUESTED", "ACTIVE"].includes(row.status);
            return <tr key={row.id}>
              <td><strong>{row.requester?.displayName ?? row.requesterId}</strong><small>{row.requester?.email ?? ""}</small></td>
              <td>{row.reason}</td>
              <td>{row.requestedMinutes} min</td>
              <td><strong>{row.effectiveActive ? "ACTIVE" : row.status}</strong>{row.decidedBy ? <small>{c("by", "onaylayan")} {row.decidedBy.displayName}</small> : null}</td>
              <td>{row.validTo ? new Date(row.validTo).toLocaleString(dateLocale) : "—"}</td>
              <td>
                {canDecide ? <>
                  <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void decide(row.id, "APPROVE")}><Check size={14}/>{c("Approve", "Onayla")}</button>
                  <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void decide(row.id, "REJECT")}><X size={14}/>{c("Reject", "Reddet")}</button>
                </> : null}
                {canRevoke ? <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void revoke(row.id)}><X size={14}/>{c("Revoke", "Geri al")}</button> : null}
                {!canDecide && !canRevoke ? "—" : null}
              </td>
            </tr>;
          }) : <tr><td colSpan={6}>{c("No emergency access history.", "Acil erişim geçmişi yok.")}</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}
