"use client";

import { ArrowDown, ArrowUp, GitBranch, LoaderCircle, Plus, RefreshCw, Save, Trash2, Workflow } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";

type Step = {
  id?: string;
  stepKey: string;
  name: string;
  actionType: string;
  assigneeRole: string;
  approvalMode: string;
  slaMinutes: string;
};

type Definition = {
  id: string;
  key: string;
  name: string;
  version: number;
  description: string | null;
  triggerType: string;
  status: string;
  steps: Array<{
    id: string;
    stepKey: string;
    name: string;
    actionType: string;
    assigneeRole: string | null;
    approvalMode: string | null;
    slaMinutes: number | null;
  }>;
};

const roles = [
  "EMPLOYEE","MANAGER","HRBP","HR_OPERATIONS","RECRUITER","TIME_ADMIN",
  "TALENT_ADMIN","COMPENSATION_ADMIN","PAYROLL_ADMIN","ER_INVESTIGATOR",
  "LEGAL","PRIVACY_OFFICER","SECURITY_AUDITOR","TENANT_ADMIN"
] as const;

const emptyStep = (): Step => ({
  stepKey: "",
  name: "",
  actionType: "TASK",
  assigneeRole: "",
  approvalMode: "",
  slaMinutes: ""
});

function normalizeKey(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

export function WorkflowDefinitionEditor() {
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;

  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("1");
  const [triggerType, setTriggerType] = useState("MANUAL");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<Step[]>([emptyStep()]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const drafts = useMemo(() => definitions.filter((item) => item.status === "DRAFT"), [definitions]);
  const editing = Boolean(selectedId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/workflows/definitions", { cache: "no-store" });
      const body = await response.json() as { data?: Definition[]; error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setDefinitions(body.data ?? []);
    } catch (cause) {
      setNotice({ kind: "error", text: cause instanceof Error ? cause.message : c("Workflow definitions could not be loaded.", "İş akışı tanımları yüklenemedi.") });
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => { void load(); }, [load]);

  function resetForm() {
    setSelectedId("");
    setKey("");
    setName("");
    setVersion("1");
    setTriggerType("MANUAL");
    setDescription("");
    setSteps([emptyStep()]);
    setNotice(null);
  }

  function editDefinition(id: string) {
    if (!id) return resetForm();
    const definition = definitions.find((item) => item.id === id);
    if (!definition || definition.status !== "DRAFT") return;
    setSelectedId(definition.id);
    setKey(definition.key);
    setName(definition.name);
    setVersion(String(definition.version));
    setTriggerType(definition.triggerType);
    setDescription(definition.description ?? "");
    setSteps(definition.steps.map((step) => ({
      id: step.id,
      stepKey: step.stepKey,
      name: step.name,
      actionType: step.actionType,
      assigneeRole: step.assigneeRole ?? "",
      approvalMode: step.approvalMode ?? "",
      slaMinutes: step.slaMinutes ? String(step.slaMinutes) : ""
    })));
    setNotice(null);
  }

  function updateStep(index: number, patch: Partial<Step>) {
    setSteps((current) => current.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step));
  }

  function moveStep(index: number, delta: -1 | 1) {
    setSteps((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeStep(index: number) {
    setSteps((current) => current.length === 1 ? current : current.filter((_, stepIndex) => stepIndex !== index));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);

    const payload = {
      ...(!editing ? { key: normalizeKey(key), version: Number(version) } : {}),
      name: name.trim(),
      triggerType: triggerType.trim(),
      description: description.trim(),
      steps: steps.map((step) => ({
        stepKey: normalizeKey(step.stepKey),
        name: step.name.trim(),
        actionType: step.actionType.trim().toUpperCase(),
        assigneeRole: step.assigneeRole || undefined,
        approvalMode: step.approvalMode.trim() || undefined,
        slaMinutes: step.slaMinutes ? Number(step.slaMinutes) : undefined
      }))
    };

    try {
      const endpoint = editing ? `/api/workflows/definitions/${encodeURIComponent(selectedId)}` : "/api/workflows/definitions";
      const response = await fetch(endpoint, {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setNotice({ kind: "ok", text: editing ? c("Workflow draft updated.", "İş akışı taslağı güncellendi.") : c("Workflow draft created.", "İş akışı taslağı oluşturuldu.") });
      await load();
      if (!editing) resetForm();
      window.dispatchEvent(new Event("hrbp:lifecycle-actions-changed"));
    } catch (cause) {
      setNotice({ kind: "error", text: cause instanceof Error ? cause.message : c("Workflow draft could not be saved.", "İş akışı taslağı kaydedilemedi.") });
    } finally {
      setBusy(false);
    }
  }

  return <section className="card workflow-definition-editor">
    <div className="workflow-editor-head">
      <div>
        <span className="section-kicker">{c("Workflow authoring", "İş akışı tasarımı")}</span>
        <h3>{c("Definition editor & step builder", "Tanım editörü & adım oluşturucu")}</h3>
        <p>{c("Create versioned workflow drafts and compose ordered, role-bound steps before independent activation.", "Bağımsız aktivasyon öncesinde sürümlü iş akışı taslakları oluşturun ve rol bazlı sıralı adımları tasarlayın.")}</p>
      </div>
      <button type="button" className="secondary-button compact" onClick={() => void load()} disabled={loading}><RefreshCw size={14}/>{c("Refresh","Yenile")}</button>
    </div>

    <div className="workflow-editor-mode">
      <label>
        <span>{c("Edit existing draft", "Mevcut taslağı düzenle")}</span>
        <select value={selectedId} onChange={(event) => editDefinition(event.target.value)}>
          <option value="">{c("Create new workflow definition", "Yeni iş akışı tanımı oluştur")}</option>
          {drafts.map((definition) => <option key={definition.id} value={definition.id}>{definition.key} · v{definition.version} · {definition.name}</option>)}
        </select>
      </label>
      {editing ? <button type="button" className="secondary-button compact" onClick={resetForm}><Plus size={14}/>{c("New definition","Yeni tanım")}</button> : null}
    </div>

    <form onSubmit={submit} className="workflow-editor-form">
      <div className="workflow-editor-metadata">
        <label><span>Key</span><input value={key} onChange={(event) => setKey(event.target.value)} onBlur={() => !editing && setKey(normalizeKey(key))} maxLength={80} required disabled={editing} placeholder="EMPLOYEE_ONBOARDING"/></label>
        <label><span>{c("Name","Ad")}</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required placeholder={c("Employee onboarding","Çalışan işe başlatma")}/></label>
        <label><span>{c("Version","Sürüm")}</span><input type="number" min={1} max={1000} value={version} onChange={(event) => setVersion(event.target.value)} required disabled={editing}/></label>
        <label><span>{c("Trigger type","Tetikleyici")}</span><input value={triggerType} onChange={(event) => setTriggerType(event.target.value)} maxLength={80} required placeholder="EVENT"/></label>
        <label className="wide"><span>{c("Description","Açıklama")}</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} placeholder={c("What starts this workflow and what outcome it governs.","Bu iş akışını neyin başlattığını ve hangi sonucu yönettiğini açıklayın.")}/></label>
      </div>

      <div className="workflow-step-builder">
        <div className="workflow-step-builder-head">
          <div><GitBranch size={16}/><span>{c("Ordered steps","Sıralı adımlar")}</span><strong>{steps.length}/50</strong></div>
          <button type="button" className="secondary-button compact" disabled={steps.length >= 50} onClick={() => setSteps((current) => [...current, emptyStep()])}><Plus size={14}/>{c("Add step","Adım ekle")}</button>
        </div>

        <div className="workflow-step-list">
          {steps.map((step, index) => <div className="workflow-step-card" key={step.id ?? `new-${index}`}>
            <div className="workflow-step-index"><span>{index + 1}</span><div><button type="button" onClick={() => moveStep(index, -1)} disabled={index === 0} aria-label={c("Move step up","Adımı yukarı taşı")}><ArrowUp size={13}/></button><button type="button" onClick={() => moveStep(index, 1)} disabled={index === steps.length - 1} aria-label={c("Move step down","Adımı aşağı taşı")}><ArrowDown size={13}/></button></div></div>
            <div className="workflow-step-fields">
              <label><span>{c("Step key","Adım anahtarı")}</span><input value={step.stepKey} onChange={(event) => updateStep(index, { stepKey: event.target.value })} onBlur={() => updateStep(index, { stepKey: normalizeKey(step.stepKey) })} maxLength={80} required placeholder="MANAGER_APPROVAL"/></label>
              <label><span>{c("Step name","Adım adı")}</span><input value={step.name} onChange={(event) => updateStep(index, { name: event.target.value })} maxLength={160} required placeholder={c("Manager approval","Yönetici onayı")}/></label>
              <label><span>{c("Action type","Aksiyon türü")}</span><input value={step.actionType} onChange={(event) => updateStep(index, { actionType: event.target.value })} maxLength={80} required placeholder="APPROVAL"/></label>
              <label><span>{c("Assignee role","Atanan rol")}</span><select value={step.assigneeRole} onChange={(event) => updateStep(index, { assigneeRole: event.target.value })}><option value="">{c("Unassigned / runtime","Atanmamış / runtime")}</option>{roles.map((role) => <option key={role} value={role}>{role.replaceAll("_"," ")}</option>)}</select></label>
              <label><span>{c("Approval mode","Onay modu")}</span><input value={step.approvalMode} onChange={(event) => updateStep(index, { approvalMode: event.target.value })} maxLength={80} placeholder="SINGLE"/></label>
              <label><span>SLA ({c("minutes","dakika")})</span><input type="number" min={1} max={43200} value={step.slaMinutes} onChange={(event) => updateStep(index, { slaMinutes: event.target.value })} placeholder="1440"/></label>
            </div>
            <button type="button" className="workflow-step-remove" disabled={steps.length === 1} onClick={() => removeStep(index)} aria-label={c("Remove step","Adımı sil")}><Trash2 size={15}/></button>
          </div>)}
        </div>
      </div>

      {notice ? <div className={`workflow-editor-message ${notice.kind}`}>{notice.text}</div> : null}

      <div className="workflow-editor-footer">
        <small>{c("Only DRAFT definitions are editable. Active definitions remain immutable; create a new version for governed changes.", "Yalnızca DRAFT tanımları düzenlenebilir. Aktif tanımlar değiştirilemez; yönetişimli değişiklikler için yeni sürüm oluşturun.")}</small>
        <button type="submit" className="primary-button" disabled={busy}>{busy ? <LoaderCircle size={15}/> : editing ? <Save size={15}/> : <Workflow size={15}/>} {busy ? c("Saving…","Kaydediliyor…") : editing ? c("Save draft","Taslağı kaydet") : c("Create workflow draft","İş akışı taslağı oluştur")}</button>
      </div>
    </form>
  </section>;
}
