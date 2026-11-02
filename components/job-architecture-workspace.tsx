import Link from "next/link";
import { BriefcaseBusiness, GraduationCap, Layers3, Network, ShieldCheck } from "lucide-react";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n-server";
import { getServerRequestContext } from "@/lib/server-session";
import { JobArchitectureAdmin } from "@/components/job-architecture-admin";
import { JobProfileLifecycleActions } from "@/components/job-profile-lifecycle-actions";

function c(locale: "en" | "tr", en: string, tr: string) { return locale === "tr" ? tr : en; }
function date(value: Date | null, locale: "en" | "tr") {
  return value ? new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { dateStyle: "medium" }).format(value) : "—";
}

export async function JobArchitectureWorkspace() {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  if (!ctx) return <section className="card"><div className="empty-state"><ShieldCheck size={24}/><h3>{c(locale,"Authentication required","Kimlik doğrulama gerekli")}</h3><p>{c(locale,"Job architecture uses live tenant master data and is unavailable on the public staging surface.","İş mimarisi canlı tenant ana verisini kullanır ve public staging yüzeyinde sunulmaz.")}</p></div></section>;
  if (!can(ctx, "job-architecture:read")) return <section className="card"><div className="empty-state"><ShieldCheck size={24}/><h3>{c(locale,"Job architecture is restricted","İş mimarisi kısıtlı")}</h3><p>{c(locale,"Your role does not include job-architecture:read.","Rolünüz job-architecture:read yetkisini içermiyor.")}</p></div></section>;

  const [families, levels, profiles, skills] = await Promise.all([
    db.jobFamily.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, description: true, active: true, _count: { select: { profiles: true } } }
    }),
    db.jobLevel.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ active: "desc" }, { rank: "asc" }],
      select: { id: true, code: true, name: true, rank: true, description: true, active: true, _count: { select: { profiles: true } } }
    }),
    db.jobProfile.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ status: "asc" }, { title: "asc" }, { effectiveFrom: "desc" }],
      take: 250,
      select: {
        id: true, code: true, title: true, status: true, effectiveFrom: true, effectiveTo: true,
        family: { select: { id: true, code: true, name: true } },
        level: { select: { id: true, code: true, name: true, rank: true } },
        skillRequirements: {
          orderBy: [{ required: "desc" }, { skill: { name: "asc" } }],
          select: { required: true, targetProficiency: true, skill: { select: { id: true, code: true, name: true } } }
        },
        _count: { select: { positions: true } }
      }
    }),
    db.skill.findMany({
      where: { tenantId: ctx.tenantId, active: true },
      orderBy: [{ critical: "desc" }, { name: "asc" }],
      take: 300,
      select: { id: true, code: true, name: true, category: true, critical: true }
    })
  ]);

  const activeProfiles = profiles.filter((item) => item.status === "ACTIVE").length;
  const mappedPositions = profiles.reduce((sum, item) => sum + item._count.positions, 0);
  const skillRequirements = profiles.reduce((sum, item) => sum + item.skillRequirements.length, 0);
  const canWrite = can(ctx, "job-architecture:write");

  return <div className="employee-detail-stack">
    <section className="page-heading module-heading">
      <div><div className="eyebrow">HRBP One / {c(locale,"Positions","Pozisyonlar")} / {c(locale,"Job Architecture","İş Mimarisi")}</div><h1>{c(locale,"Job Architecture","İş Mimarisi")}</h1><p>{c(locale,"Govern families, levels, effective-dated profiles and required skills before they become position, recruiting, compensation and workforce-planning inputs.","İş ailesi, seviye, geçerlilik tarihli profil ve gerekli yetkinlikleri pozisyon, işe alım, ücret ve iş gücü planlama girdisine dönüşmeden önce yönetin.")}</p></div>
      <div className="module-heading-actions"><Link className="secondary-button" href="/module/positions">{c(locale,"Positions","Pozisyonlar")}</Link>{canWrite ? <Link className="create-button" href="/module/positions/new">{c(locale,"Create position","Pozisyon oluştur")}</Link> : null}</div>
    </section>

    <section className="enterprise-stats">
      <div className="enterprise-stat"><div className="enterprise-stat-icon"><Network size={17}/></div><div><span>{c(locale,"Active families","Aktif iş aileleri")}</span><strong>{families.filter((item) => item.active).length}</strong><small>{c(locale,"Governed taxonomy","Yönetişimli taksonomi")}</small></div></div>
      <div className="enterprise-stat"><div className="enterprise-stat-icon"><Layers3 size={17}/></div><div><span>{c(locale,"Active profiles","Aktif profiller")}</span><strong>{activeProfiles}</strong><small>{c(locale,"Effective-dated roles","Geçerlilik tarihli roller")}</small></div></div>
      <div className="enterprise-stat"><div className="enterprise-stat-icon"><GraduationCap size={17}/></div><div><span>{c(locale,"Skill requirements","Yetkinlik gereksinimleri")}</span><strong>{skillRequirements}</strong><small>{c(locale,"Human-governed proficiency targets","İnsan yönetişimli yetkinlik hedefleri")}</small></div></div>
      <div className="enterprise-stat"><div className="enterprise-stat-icon"><BriefcaseBusiness size={17}/></div><div><span>{c(locale,"Mapped positions","Eşlenmiş pozisyonlar")}</span><strong>{mappedPositions}</strong><small>{c(locale,"Structured profile references","Yapısal profil referansları")}</small></div></div>
    </section>

    {canWrite ? <JobArchitectureAdmin
      families={families.filter((item) => item.active).map(({ id, code, name }) => ({ id, code, name }))}
      levels={levels.filter((item) => item.active).map(({ id, code, name, rank }) => ({ id, code, name, rank }))}
      skills={skills}
    /> : null}

    <section className="card enterprise-table-card">
      <div className="table-title"><div><h3>{c(locale,"Job profiles","İş profilleri")}</h3><p>{c(locale,"Effective-dated role definitions connect family, career level, skills and positions.","Geçerlilik tarihli rol tanımları iş ailesi, kariyer seviyesi, yetkinlik ve pozisyonları bağlar.")}</p></div><span>{profiles.length} {c(locale,"profiles","profil")}</span></div>
      <div className="table-wrap"><table className="enterprise-table"><thead><tr><th>{c(locale,"Profile","Profil")}</th><th>{c(locale,"Family","İş ailesi")}</th><th>{c(locale,"Level","Seviye")}</th><th>{c(locale,"Skills","Yetkinlikler")}</th><th>{c(locale,"Positions","Pozisyonlar")}</th><th>{c(locale,"Effective","Geçerlilik")}</th><th>{c(locale,"Status","Durum")}</th>{canWrite ? <th>{c(locale,"Lifecycle","Yaşam döngüsü")}</th> : null}</tr></thead><tbody>
        {profiles.length ? profiles.map((profile) => <tr key={profile.id}>
          <td><strong className="cell-strong">{profile.title}</strong><small className="cell-sub">{profile.code}</small></td>
          <td>{profile.family.name}<small className="cell-sub">{profile.family.code}</small></td>
          <td>{profile.level.name}<small className="cell-sub">{profile.level.code} · #{profile.level.rank}</small></td>
          <td>{profile.skillRequirements.length ? profile.skillRequirements.slice(0,3).map((item) => <span key={item.skill.id} className="critical-badge" style={{ marginRight: 4 }}>{item.skill.code} · {item.targetProficiency}{item.required ? "" : " · optional"}</span>) : "—"}{profile.skillRequirements.length > 3 ? <small className="cell-sub">+{profile.skillRequirements.length - 3}</small> : null}</td>
          <td>{profile._count.positions}</td>
          <td>{date(profile.effectiveFrom, locale)} → {date(profile.effectiveTo, locale)}</td>
          <td><em className={`pill ${profile.status.toLowerCase()}`}>{profile.status}</em></td>
          {canWrite ? <td><JobProfileLifecycleActions id={profile.id} status={profile.status}/></td> : null}
        </tr>) : <tr><td colSpan={canWrite ? 8 : 7} style={{ textAlign: "center", padding: 28 }}>{c(locale,"No job profiles configured yet.","Henüz iş profili tanımlanmadı.")}</td></tr>}
      </tbody></table></div>
    </section>

    <section className="profile-grid two-column">
      <div className="card enterprise-table-card"><div className="table-title"><div><h3>{c(locale,"Job families","İş aileleri")}</h3><p>{c(locale,"Stable categories for related work.","Benzer işler için stabil kategoriler.")}</p></div></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>{c(locale,"Code","Kod")}</th><th>{c(locale,"Name","Ad")}</th><th>{c(locale,"Profiles","Profiller")}</th></tr></thead><tbody>{families.map((item) => <tr key={item.id}><td><code>{item.code}</code></td><td>{item.name}{!item.active ? <small className="cell-sub">{c(locale,"Inactive","Pasif")}</small> : null}</td><td>{item._count.profiles}</td></tr>)}</tbody></table></div></div>
      <div className="card enterprise-table-card"><div className="table-title"><div><h3>{c(locale,"Career levels","Kariyer seviyeleri")}</h3><p>{c(locale,"Tenant-owned ordering without hard-coded global grades.","Global kademeleri dayatmadan tenant kontrollü sıralama.")}</p></div></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>{c(locale,"Rank","Sıra")}</th><th>{c(locale,"Level","Seviye")}</th><th>{c(locale,"Profiles","Profiller")}</th></tr></thead><tbody>{levels.map((item) => <tr key={item.id}><td>#{item.rank}</td><td><strong className="cell-strong">{item.name}</strong><small className="cell-sub">{item.code}</small></td><td>{item._count.profiles}</td></tr>)}</tbody></table></div></div>
    </section>
  </div>;
}
