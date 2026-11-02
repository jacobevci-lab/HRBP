"use client";

import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { useLocale } from "@/components/locale-provider";

type FamilyOption = { id: string; code: string; name: string };
type LevelOption = { id: string; code: string; name: string; rank: number };
type SkillOption = { id: string; code: string; name: string; category: string | null; critical: boolean };
type Notice = { tone: "ok" | "error"; text: string } | null;
type Requirement = { key: number; skillId: string; targetProficiency: string; required: boolean };

const proficiencyOptions = ["AWARENESS", "FOUNDATION", "PRACTITIONER", "ADVANCED", "EXPERT"] as const;

export function JobArchitectureAdmin({ families, levels, skills }: {
  families: FamilyOption[];
  levels: LevelOption[];
  skills: SkillOption[];
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = (en: string, tr: string) => locale === "tr" ? tr : en;
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [nextRequirementKey, setNextRequirementKey] = useState(1);

  async function post(kind: string, url: string, payload: unknown, form: HTMLFormElement, after?: () => void) {
    if (busy) return;
    setBusy(kind); setNotice(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-purpose": "Job architecture administration" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? c("Job architecture change failed.", "İş mimarisi değişikliği başarısız oldu."));
      form.reset();
      after?.();
      setNotice({ tone: "ok", text: c("Governed master data saved and added to the audit ledger.", "Yönetişimli ana veri kaydedildi ve denetim kaydına eklendi.") });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : c("Job architecture change failed.", "İş mimarisi değişikliği başarısız oldu.") });
    } finally { setBusy(null); }
  }

  function addRequirement() {
    setRequirements((current) => [...current, {
      key: nextRequirementKey,
      skillId: "",
      targetProficiency: "PRACTITIONER",
      required: true
    }]);
    setNextRequirementKey((value) => value + 1);
  }

  return <section className="card" style={{ padding: 16 }}>
    <div className="table-title"><div><h3>{c("Architecture administration","Mimari yönetimi")}</h3><p>{c("Create governed taxonomy records. Existing positions are never remapped automatically.","Yönetişimli taksonomi kayıtları oluşturun. Mevcut pozisyonlar otomatik olarak yeniden eşlenmez.")}</p></div></div>
    {notice ? <div className={`performance-notice ${notice.tone}`} aria-live="polite">{notice.text}</div> : null}
    <div className="profile-grid" style={{ alignItems: "start" }}>
      <details className="card" style={{ padding: 14 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>{c("Create job family","İş ailesi oluştur")}</summary>
        <form style={{ display: "grid", gap: 9, marginTop: 12 }} onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const form = event.currentTarget, values = new FormData(form);
          void post("family", "/api/job-architecture/families", {
            code: values.get("code"), name: values.get("name"), description: values.get("description")
          }, form);
        }}>
          <input name="code" maxLength={64} required placeholder={c("Code e.g. ENGINEERING","Kod örn. ENGINEERING")}/>
          <input name="name" maxLength={180} required placeholder={c("Family name","İş ailesi adı")}/>
          <textarea name="description" maxLength={2000} rows={3} placeholder={c("Description (optional)","Açıklama (opsiyonel)")}/>
          <button className="create-button" type="submit" disabled={busy !== null}>{busy === "family" ? c("Saving…","Kaydediliyor…") : c("Create family","İş ailesi oluştur")}</button>
        </form>
      </details>

      <details className="card" style={{ padding: 14 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>{c("Create career level","Kariyer seviyesi oluştur")}</summary>
        <form style={{ display: "grid", gap: 9, marginTop: 12 }} onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const form = event.currentTarget, values = new FormData(form);
          void post("level", "/api/job-architecture/levels", {
            code: values.get("code"), name: values.get("name"), rank: Number(values.get("rank")), description: values.get("description")
          }, form);
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 9 }}>
            <input name="code" maxLength={64} required placeholder={c("Code e.g. IC4","Kod örn. IC4")}/>
            <input name="rank" type="number" min={1} max={1000} step={1} required placeholder={c("Rank","Sıra")}/>
          </div>
          <input name="name" maxLength={180} required placeholder={c("Level name","Seviye adı")}/>
          <textarea name="description" maxLength={2000} rows={3} placeholder={c("Description (optional)","Açıklama (opsiyonel)")}/>
          <button className="create-button" type="submit" disabled={busy !== null}>{busy === "level" ? c("Saving…","Kaydediliyor…") : c("Create level","Seviye oluştur")}</button>
        </form>
      </details>
    </div>

    <details className="card" style={{ padding: 14, marginTop: 12 }} open>
      <summary style={{ cursor: "pointer", fontWeight: 800 }}>{c("Create effective-dated job profile","Geçerlilik tarihli iş profili oluştur")}</summary>
      <form style={{ display: "grid", gap: 10, marginTop: 12 }} onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget, values = new FormData(form);
        void post("profile", "/api/job-architecture/profiles", {
          code: values.get("code"),
          title: values.get("title"),
          familyId: values.get("familyId"),
          levelId: values.get("levelId"),
          status: values.get("status"),
          effectiveFrom: values.get("effectiveFrom"),
          effectiveTo: values.get("effectiveTo"),
          description: values.get("description"),
          skillRequirements: requirements.filter((item) => item.skillId).map(({ skillId, targetProficiency, required }) => ({
            skillId, targetProficiency, required
          }))
        }, form, () => setRequirements([]));
      }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 9 }}>
          <input name="code" maxLength={64} required placeholder={c("Profile code e.g. SEC.ENG.IC4","Profil kodu örn. SEC.ENG.IC4")}/>
          <input name="title" maxLength={180} required placeholder={c("Profile title","Profil adı")}/>
          <select name="familyId" required defaultValue=""><option value="" disabled>{c("Select family","İş ailesi seçin")}</option>{families.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select>
          <select name="levelId" required defaultValue=""><option value="" disabled>{c("Select level","Seviye seçin")}</option>{levels.map((item) => <option key={item.id} value={item.id}>#{item.rank} · {item.code} · {item.name}</option>)}</select>
          <select name="status" defaultValue="DRAFT"><option value="DRAFT">{c("Draft","Taslak")}</option><option value="ACTIVE">{c("Active","Aktif")}</option></select>
          <label style={{ display: "grid", gap: 5 }}><small>{c("Effective from","Geçerlilik başlangıcı")}</small><input name="effectiveFrom" type="date" required/></label>
          <label style={{ display: "grid", gap: 5 }}><small>{c("Effective to (optional)","Geçerlilik bitişi (opsiyonel)")}</small><input name="effectiveTo" type="date"/></label>
        </div>
        <textarea name="description" maxLength={4000} rows={3} placeholder={c("Role purpose and scope (optional)","Rol amacı ve kapsamı (opsiyonel)")}/>

        <div className="card" style={{ padding: 12 }}>
          <div className="table-title"><div><strong>{c("Skill requirements","Yetkinlik gereksinimleri")}</strong><small className="cell-sub">{c("Optional at creation; each skill can appear only once.","Oluşturma sırasında opsiyoneldir; her yetkinlik yalnızca bir kez eklenebilir.")}</small></div><button type="button" className="secondary-button" onClick={addRequirement} disabled={requirements.length >= 50 || !skills.length}><Plus size={14}/>{c("Add skill","Yetkinlik ekle")}</button></div>
          <div style={{ display: "grid", gap: 8 }}>
            {requirements.map((item) => <div key={item.key} style={{ display: "grid", gridTemplateColumns: "minmax(220px,2fr) minmax(160px,1fr) auto auto", gap: 8, alignItems: "center" }}>
              <select value={item.skillId} onChange={(event) => setRequirements((rows) => rows.map((row) => row.key === item.key ? { ...row, skillId: event.target.value } : row))}>
                <option value="">{c("Select skill","Yetkinlik seçin")}</option>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.code} · {skill.name}{skill.critical ? " · critical" : ""}</option>)}
              </select>
              <select value={item.targetProficiency} onChange={(event) => setRequirements((rows) => rows.map((row) => row.key === item.key ? { ...row, targetProficiency: event.target.value } : row))}>{proficiencyOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
              <label className="form-check"><input type="checkbox" checked={item.required} onChange={(event) => setRequirements((rows) => rows.map((row) => row.key === item.key ? { ...row, required: event.target.checked } : row))}/><span>{c("Required","Zorunlu")}</span></label>
              <button type="button" className="row-action" aria-label={c("Remove skill requirement","Yetkinlik gereksinimini kaldır")} onClick={() => setRequirements((rows) => rows.filter((row) => row.key !== item.key))}><Trash2 size={15}/></button>
            </div>)}
            {!requirements.length ? <small>{c("No skill requirements added yet.","Henüz yetkinlik gereksinimi eklenmedi.")}</small> : null}
          </div>
        </div>

        <button className="create-button" type="submit" disabled={busy !== null || !families.length || !levels.length}>{busy === "profile" ? c("Saving…","Kaydediliyor…") : c("Create job profile","İş profili oluştur")}</button>
      </form>
    </details>
  </section>;
}
