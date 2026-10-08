"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, BadgeCheck, BriefcaseBusiness, CircleAlert, ExternalLink, ShieldCheck, TrendingUp } from "lucide-react";
import { useLocale } from "@/components/locale-provider";

interface PositionOption {
  id: string;
  positionCode: string;
  title: string;
  status: string;
  location: string | null;
  orgUnit?: { name: string } | null;
}

type PreviewPosition = {
  id: string;
  positionCode: string;
  title: string;
  grade: string | null;
  location: string | null;
  critical: boolean;
  orgUnit: { id: string; name: string };
};

type PositionChangePreview = {
  receipt: string;
  expiresAt: string;
  employmentId: string;
  eventType: "TRANSFERRED" | "PROMOTED";
  effectiveAt: string;
  sourcePosition: PreviewPosition | null;
  targetPosition: PreviewPosition;
  impacts: {
    orgUnitChanged: boolean;
    gradeChanged: boolean;
    locationChanged: boolean;
    directReportCount: number;
    managerRelationshipPresent: boolean;
    openTargetRequisitionCount: number;
  };
  warnings: string[];
};

type Notice = { kind: "ok" | "error"; message: string } | null;

export function EmployeeLifecycleConsole({
  personId,
  employeeName,
  currentPosition,
  currentDepartment,
  canMove,
  canOffboard
}: {
  personId: string;
  employeeName: string;
  currentPosition: string;
  currentDepartment: string;
  canMove: boolean;
  canOffboard: boolean;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = useCallback((en: string, trValue: string) => tr ? trValue : en, [tr]);

  const [positions, setPositions] = useState<PositionOption[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(canMove);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [preview, setPreview] = useState<PositionChangePreview | null>(null);
  const [eventType, setEventType] = useState<"TRANSFERRED" | "PROMOTED">("TRANSFERRED");
  const [targetPositionId, setTargetPositionId] = useState("");
  const [effectiveAt, setEffectiveAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!canMove) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/positions", { cache: "no-store" });
        const payload = await response.json() as { data?: PositionOption[]; error?: string };
        if (!response.ok) throw new Error(payload.error || c("Positions could not be loaded.", "Pozisyonlar yüklenemedi."));
        if (!cancelled) setPositions((payload.data ?? []).filter((position) => position.status === "OPEN"));
      } catch (error) {
        if (!cancelled) {
          setNotice({
            kind: "error",
            message: error instanceof Error ? error.message : c("Positions could not be loaded.", "Pozisyonlar yüklenemedi.")
          });
        }
      } finally {
        if (!cancelled) setLoadingPositions(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canMove, c]);

  useEffect(() => {
    setPreview(null);
  }, [targetPositionId, eventType, effectiveAt, reason]);

  const selected = useMemo(
    () => positions.find((position) => position.id === targetPositionId),
    [positions, targetPositionId]
  );

  const warningText = useCallback((warning: string) => {
    const messages: Record<string, [string, string]> = {
      DIRECT_REPORT_RELATIONSHIPS_UNCHANGED: [
        "Direct-report relationships are not automatically reassigned by this position change.",
        "Doğrudan bağlı çalışan ilişkileri bu pozisyon değişikliğiyle otomatik olarak yeniden atanmaz."
      ],
      MANAGER_RELATIONSHIP_UNCHANGED: [
        "The current manager relationship remains unchanged even though the organization unit changes.",
        "Organizasyon birimi değişse bile mevcut yönetici ilişkisi değişmeden kalır."
      ],
      TARGET_REQUISITIONS_REMAIN_OPEN: [
        "The target position still has an open recruiting requisition that must be reviewed separately.",
        "Hedef pozisyon için ayrıca incelenmesi gereken açık işe alım talebi bulunuyor."
      ],
      TARGET_POSITION_IS_CRITICAL: [
        "The target is marked as a critical position.",
        "Hedef pozisyon kritik pozisyon olarak işaretli."
      ]
    };
    const message = messages[warning];
    return message ? c(message[0], message[1]) : warning.replaceAll("_", " ");
  }, [c]);

  async function generatePreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetPositionId) {
      setNotice({ kind: "error", message: c("Select an open target position.", "Açık bir hedef pozisyon seçin.") });
      return;
    }

    setPreviewBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/people/" + encodeURIComponent(personId) + "/lifecycle/position/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetPositionId, eventType, effectiveAt, reason })
      });
      const payload = await response.json() as { data?: PositionChangePreview; error?: string };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error || c("Impact preview could not be generated.", "Etki önizlemesi oluşturulamadı."));
      }
      setPreview(payload.data);
      setNotice({
        kind: "ok",
        message: c(
          "Impact preview is ready. Review the consequences before applying the change.",
          "Etki önizlemesi hazır. Değişikliği uygulamadan önce sonuçları kontrol edin."
        )
      });
    } catch (error) {
      setPreview(null);
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : c("Impact preview failed.", "Etki önizlemesi başarısız.")
      });
    } finally {
      setPreviewBusy(false);
    }
  }

  async function applyPositionChange() {
    if (!preview || applyBusy) return;
    setApplyBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/people/" + encodeURIComponent(personId) + "/lifecycle/position", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetPositionId,
          eventType,
          effectiveAt,
          reason,
          previewReceipt: preview.receipt
        })
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || c("Lifecycle change failed.", "Yaşam döngüsü değişikliği başarısız."));

      setNotice({
        kind: "ok",
        message: eventType === "PROMOTED"
          ? c("Promotion completed and written to the lifecycle ledger.", "Terfi tamamlandı ve yaşam döngüsü kaydına işlendi.")
          : c("Transfer completed and written to the lifecycle ledger.", "Transfer tamamlandı ve yaşam döngüsü kaydına işlendi.")
      });
      setPreview(null);
      setTargetPositionId("");
      setReason("");
      router.refresh();
    } catch (error) {
      setPreview(null);
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : c("Lifecycle change failed.", "Yaşam döngüsü değişikliği başarısız.")
      });
    } finally {
      setApplyBusy(false);
    }
  }

  return <div className="lifecycle-console-stack">
    <section className="card lifecycle-command-card">
      <div className="lifecycle-command-head">
        <div>
          <span className="section-kicker">{c("Governed lifecycle command", "Yönetişim kontrollü yaşam döngüsü")}</span>
          <h2>{employeeName}</h2>
          <p>{currentPosition} · {currentDepartment}</p>
        </div>
        <div className="lifecycle-command-health">
          <ShieldCheck size={16}/>
          <span>{c("RBAC + signed impact preview + audit + tenant isolation", "RBAC + imzalı etki önizlemesi + denetim + tenant izolasyonu")}</span>
        </div>
      </div>

      {notice ? <div className={"lifecycle-notice " + notice.kind}><CircleAlert size={15}/><span>{notice.message}</span></div> : null}

      <div className="lifecycle-command-grid">
        <form className="lifecycle-action-panel" onSubmit={generatePreview}>
          <div className="lifecycle-action-title">
            <ArrowRightLeft size={18}/>
            <div>
              <strong>{c("Position change", "Pozisyon değişikliği")}</strong>
              <small>{c(
                "Transfer or promotion requires a fresh signed impact preview before the mutation can execute.",
                "Transfer veya terfi uygulanmadan önce güncel ve imzalı etki önizlemesi zorunludur."
              )}</small>
            </div>
          </div>

          {!canMove ? <div className="lifecycle-restricted">
            <ShieldCheck size={16}/>
            <span>{c("This action requires people:write and positions:write.", "Bu işlem people:write ve positions:write yetkilerini gerektirir.")}</span>
          </div> : <>
            <label>{c("Change type", "Değişiklik türü")}
              <select value={eventType} onChange={(event) => setEventType(event.target.value as "TRANSFERRED" | "PROMOTED")} disabled={previewBusy || applyBusy}>
                <option value="TRANSFERRED">{c("Transfer", "Transfer")}</option>
                <option value="PROMOTED">{c("Promotion", "Terfi")}</option>
              </select>
            </label>

            <label>{c("Target position", "Hedef pozisyon")}
              <select value={targetPositionId} onChange={(event) => setTargetPositionId(event.target.value)} disabled={loadingPositions || previewBusy || applyBusy}>
                <option value="">{loadingPositions ? c("Loading open positions…", "Açık pozisyonlar yükleniyor…") : c("Select an open position", "Açık pozisyon seçin")}</option>
                {positions.map((position) => <option key={position.id} value={position.id}>
                  {position.positionCode} · {position.title} · {position.orgUnit?.name ?? c("Unassigned", "Atanmadı")}
                </option>)}
              </select>
            </label>

            {selected ? <div className="lifecycle-target-preview">
              <BriefcaseBusiness size={16}/>
              <div>
                <strong>{selected.title}</strong>
                <small>{selected.positionCode} · {selected.orgUnit?.name ?? c("Unassigned", "Atanmadı")} · {selected.location ?? c("Location not set", "Lokasyon tanımlı değil")}</small>
              </div>
            </div> : null}

            <div className="lifecycle-form-row">
              <label>{c("Effective date", "Geçerlilik tarihi")}
                <input type="date" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required disabled={previewBusy || applyBusy}/>
              </label>
              <label>{c("Reason", "Gerekçe")}
                <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} disabled={previewBusy || applyBusy} placeholder={c("Business reason / approval reference", "İş gerekçesi / onay referansı")}/>
              </label>
            </div>

            <button className="create-button" type="submit" disabled={previewBusy || applyBusy || loadingPositions || !targetPositionId}>
              {eventType === "PROMOTED" ? <TrendingUp size={16}/> : <ArrowRightLeft size={16}/>}
              {previewBusy ? c("Reviewing impact…", "Etki inceleniyor…") : preview ? c("Refresh impact preview", "Etki önizlemesini yenile") : c("Review impact", "Etkiyi incele")}
            </button>

            {preview ? <div className="lifecycle-rule-list">
              <div><span>1</span><p><strong>{c("Signed preview", "İmzalı önizleme")}</strong><br/>{c("Valid until", "Geçerli olduğu zaman")}: {new Date(preview.expiresAt).toLocaleString(tr ? "tr-TR" : "en-US")}</p></div>
              <div><span>2</span><p><strong>{c("Position", "Pozisyon")}</strong><br/>{preview.sourcePosition?.title ?? c("Unassigned", "Atanmamış")} → {preview.targetPosition.title}</p></div>
              <div><span>3</span><p><strong>{c("Organization / grade / location change", "Organizasyon / seviye / lokasyon değişimi")}</strong><br/>{preview.impacts.orgUnitChanged ? c("Yes", "Evet") : c("No", "Hayır")} / {preview.impacts.gradeChanged ? c("Yes", "Evet") : c("No", "Hayır")} / {preview.impacts.locationChanged ? c("Yes", "Evet") : c("No", "Hayır")}</p></div>
              <div><span>4</span><p><strong>{c("Related records", "İlişkili kayıtlar")}</strong><br/>{c(
                String(preview.impacts.directReportCount) + " direct report(s) · " + String(preview.impacts.openTargetRequisitionCount) + " open target requisition(s)",
                String(preview.impacts.directReportCount) + " bağlı çalışan · " + String(preview.impacts.openTargetRequisitionCount) + " açık hedef işe alım talebi"
              )}</p></div>
              {preview.warnings.map((warning, index) => <div key={warning}><span>{index + 5}</span><p><strong>{c("Review warning", "Kontrol uyarısı")}</strong><br/>{warningText(warning)}</p></div>)}
            </div> : null}

            {preview ? <button className="create-button" type="button" disabled={applyBusy || previewBusy} onClick={() => void applyPositionChange()}>
              <ShieldCheck size={16}/>
              {applyBusy
                ? c("Applying governed change…", "Yönetişim kontrollü değişiklik uygulanıyor…")
                : eventType === "PROMOTED"
                  ? c("Confirm and apply promotion", "Terfiyi onayla ve uygula")
                  : c("Confirm and apply transfer", "Transferi onayla ve uygula")}
            </button> : null}
          </>}
        </form>

        <div className="lifecycle-action-panel">
          <div className="lifecycle-action-title">
            <BadgeCheck size={18}/>
            <div>
              <strong>{c("Separation / offboarding", "Ayrılış / işten çıkış")}</strong>
              <small>{c(
                "Termination is orchestrated through the governed offboarding process, never as a direct record edit.",
                "İstihdam sonlandırması doğrudan kayıt düzenleme ile değil, yönetişim kontrollü offboarding süreciyle orkestre edilir."
              )}</small>
            </div>
          </div>
          <div className="lifecycle-rule-list">
            <div><span>1</span><p>{c("Create separation process and last working date", "Ayrılış sürecini ve son çalışma tarihini oluştur")}</p></div>
            <div><span>2</span><p>{c("Complete HR, manager, IT, facilities and payroll controls", "İK, yönetici, BT, idari işler ve bordro kontrollerini tamamla")}</p></div>
            <div><span>3</span><p>{c("Revoke access, recover assets and close final settlement", "Erişimi kaldır, varlıkları geri al ve nihai mutabakatı kapat")}</p></div>
            <div><span>4</span><p>{c("Finalize employment and write termination lifecycle evidence", "İstihdamı sonlandır ve ayrılış yaşam döngüsü kanıtını yaz")}</p></div>
          </div>
          {canOffboard ? <Link className="secondary-button lifecycle-offboard-link" href="/module/offboarding">
            <ExternalLink size={15}/> {c("Open governed offboarding", "Yönetişim kontrollü offboarding'i aç")}
          </Link> : <div className="lifecycle-restricted">
            <ShieldCheck size={16}/>
            <span>{c("Your role does not include offboarding:write.", "Rolünüz offboarding:write yetkisini içermiyor.")}</span>
          </div>}
        </div>
      </div>
    </section>

    <section className="card lifecycle-control-note">
      <ShieldCheck size={18}/>
      <div>
        <strong>{c("Control boundary", "Kontrol sınırı")}</strong>
        <p>{c(
          "Position changes require an open target position, reject duplicate incumbents, and require a fresh signed preview bound to the actor, employee, target, event type, effective date and reason. The apply step rechecks current employment and target state before updating the position register, lifecycle ledger and immutable audit evidence in one transaction.",
          "Pozisyon değişiklikleri açık hedef pozisyon gerektirir, aynı kadroya birden fazla çalışan atanmasını engeller ve aktör, çalışan, hedef, işlem türü, geçerlilik tarihi ve gerekçeye bağlı güncel imzalı önizleme ister. Uygulama adımı mevcut istihdam ve hedef durumunu yeniden kontrol ederek pozisyon envanterini, yaşam döngüsü kaydını ve değiştirilemez denetim kanıtını tek işlemde günceller."
        )}</p>
      </div>
    </section>
  </div>;
}
