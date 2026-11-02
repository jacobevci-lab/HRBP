"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, Save } from "lucide-react";
import { FormEvent, useState } from "react";
import { useLocale } from "@/components/locale-provider";

export type OrganizationOption = { id: string; code: string; name: string; type: string };
export type JobProfileOption = { id: string; code: string; title: string; familyName: string; levelCode: string; levelName: string; rank: number };

export function PositionCreateForm({ organizations, jobProfiles }: { organizations: OrganizationOption[]; jobProfiles: JobProfileOption[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const tr = locale === "tr";
  const c = (en: string, trValue: string) => tr ? trValue : en;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [jobProfileId, setJobProfileId] = useState("");
  const selectedProfile = jobProfiles.find((item) => item.id === jobProfileId) ?? null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setError(null); setRequiresAuth(false);
    const form = new FormData(event.currentTarget);
    const payload = { positionCode: String(form.get("positionCode") ?? ""), title: String(form.get("title") ?? ""), orgUnitId: String(form.get("orgUnitId") ?? ""), jobProfileId, jobFamily: selectedProfile ? "" : String(form.get("jobFamily") ?? ""), grade: selectedProfile ? "" : String(form.get("grade") ?? ""), location: String(form.get("location") ?? ""), status: String(form.get("status") ?? "OPEN"), critical: form.get("critical") === "on" };
    try {
      const response = await fetch("/api/positions", { method: "POST", headers: { "content-type": "application/json", "x-purpose": "Workforce management" }, body: JSON.stringify(payload) });
      const value = await response.json() as { error?: string };
      if (!response.ok) { if (response.status === 401) setRequiresAuth(true); setError(value.error || c("Position could not be created.","Pozisyon oluşturulamadı.")); return; }
      router.push("/module/positions"); router.refresh();
    } catch { setError(c("The request could not reach HRBP. Try again.","İstek HRBP'ye ulaştırılamadı. Tekrar deneyin.")); }
    finally { setSubmitting(false); }
  }

  return <div className="card record-form-card"><div className="record-form-header"><h2>{c("Position record","Pozisyon kaydı")}</h2><p>{c("Create a budgeted organizational seat independently from an incumbent. Hiring will assign an employee to this record later.","Mevcut çalışandan bağımsız bütçelenmiş bir organizasyon kadrosu oluşturun. İşe alım sırasında çalışan bu kayda atanır.")}</p></div><form className="record-form" onSubmit={submit}>
    <div className="form-field"><label htmlFor="positionCode">{c("Position code","Pozisyon kodu")}</label><input id="positionCode" name="positionCode" required autoComplete="off" placeholder="SEC-004"/></div>
    <div className="form-field"><label htmlFor="status">{c("Initial status","Başlangıç durumu")}</label><select id="status" name="status" defaultValue="OPEN"><option value="OPEN">{c("Open","Açık")}</option><option value="PLANNED">{c("Planned","Planlandı")}</option></select></div>
    <div className="form-field full"><label htmlFor="title">{c("Position title","Pozisyon adı")}</label><input id="title" name="title" required placeholder="Senior Security Engineer"/></div>
    <div className="form-field full"><label htmlFor="orgUnitId">{c("Organization unit","Organizasyon birimi")}</label><select id="orgUnitId" name="orgUnitId" required defaultValue=""><option value="" disabled>{c("Select organization unit","Organizasyon birimi seçin")}</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.code} · {org.name} · {org.type}</option>)}</select></div>
    <div className="form-field full"><label htmlFor="jobProfileId">{c("Job profile (recommended)","İş profili (önerilen)")}</label><select id="jobProfileId" name="jobProfileId" value={jobProfileId} onChange={(event) => setJobProfileId(event.target.value)}><option value="">{c("No structured profile — use legacy family/grade","Yapısal profil yok — legacy iş ailesi/seviye kullan")}</option>{jobProfiles.map((profile) => <option key={profile.id} value={profile.id}>#{profile.rank} · {profile.code} · {profile.title} · {profile.familyName}</option>)}</select>{selectedProfile ? <small>{selectedProfile.familyName} · {selectedProfile.levelCode} · {selectedProfile.levelName}</small> : <small>{c("Structured profiles keep positions, recruiting, skills and compensation on the same governed taxonomy.","Yapısal profiller pozisyon, işe alım, yetkinlik ve ücret süreçlerini aynı yönetişimli taksonomide tutar.")}</small>}</div>
    <div className="form-field"><label htmlFor="jobFamily">{c("Legacy job family fallback","Legacy iş ailesi fallback")}</label><input id="jobFamily" name="jobFamily" disabled={Boolean(selectedProfile)} placeholder="Security"/></div>
    <div className="form-field"><label htmlFor="grade">{c("Legacy grade fallback","Legacy seviye fallback")}</label><input id="grade" name="grade" disabled={Boolean(selectedProfile)} placeholder="IC4"/></div>
    <div className="form-field full"><label htmlFor="location">{c("Location","Lokasyon")}</label><input id="location" name="location" placeholder="Istanbul / Remote EU"/></div>
    <div className="form-field full"><label className="form-check"><input type="checkbox" name="critical"/> <span><strong>{c("Critical position","Kritik pozisyon")}</strong><small>{c("Include this seat in business-continuity and succession coverage signals.","Bu kadroyu iş sürekliliği ve yedekleme kapsamı sinyallerine dahil et.")}</small></span></label></div>
    {error ? <div className="form-error">{error}{requiresAuth ? <> <Link href="/auth/sign-in?returnTo=%2Fmodule%2Fpositions%2Fnew">{c("Sign in with enterprise SSO.","Kurumsal SSO ile giriş yapın.")}</Link></> : null}</div> : null}
    <div className="form-actions"><Link className="secondary-button" href="/module/positions">{c("Cancel","İptal")}</Link><button className="create-button" type="submit" disabled={submitting || organizations.length === 0}><Save size={15}/>{submitting ? c("Creating…","Oluşturuluyor…") : c("Create position","Pozisyon oluştur")}</button></div>
  </form><div className="governance-note" style={{ margin: "0 20px 20px" }}><BriefcaseBusiness size={17}/><p>{c("Current position codes are tenant-scoped, organization and Job Profile ownership are verified server-side, structured profiles snapshot canonical family/level values for backward compatibility and every position creation is added to the audit ledger.","Pozisyon kodları tenant kapsamında benzersizdir, organizasyon ve İş Profili sahipliği sunucu tarafında doğrulanır, yapısal profiller geriye uyumluluk için kanonik iş ailesi/seviye değerlerini snapshot olarak yazar ve her pozisyon oluşturma işlemi denetim kaydına eklenir.")}</p></div></div>;
}
