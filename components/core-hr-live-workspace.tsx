import Link from "next/link";
import type { ComponentType } from "react";
import { BadgeCheck, BadgeDollarSign, BriefcaseBusiness, Building2, ChevronRight, CircleAlert, Clock3, FileText, History, LockKeyhole, Network, ShieldCheck, UserCheck, UsersRound } from "lucide-react";
import { getEmployee360Data, getOrganizationWorkspaceData, getPeopleWorkspaceData, getPositionsWorkspaceData } from "@/lib/core-hr-live-data";
import { can } from "@/lib/authorization";
import { getServerRequestContext } from "@/lib/server-session";
import { getServerLocale } from "@/lib/i18n-server";
import type { Locale } from "@/lib/i18n";
import { CompensationRequestForm, ManagerAssignmentForm } from "@/components/employee-360-actions";
import { Employee360Rail } from "@/components/employee-360-rail";
import { EnterpriseViewToolbar } from "@/components/enterprise-view-toolbar";
import { EnterprisePagination } from "@/components/enterprise-pagination";
import { PositionBulkActionForm } from "@/components/position-bulk-action-form";
import { listSavedEnterpriseViews, sanitizeEnterpriseViewState } from "@/lib/enterprise-saved-views";

function c(locale: Locale, en: string, tr: string) { return locale === "tr" ? tr : en; }
function localStatus(locale: Locale, value: string) {
  if (locale !== "tr") return value;
  const map: Record<string,string> = { ACTIVE:"Aktif", PREBOARDING:"İşe başlamadan önce", "ON LEAVE":"İzinde", TERMINATED:"Sonlandırıldı", OPEN:"Açık", PLANNED:"Planlandı", FILLED:"Dolu", APPROVED:"Onaylandı", APPROVAL:"Onay bekliyor", APPLIED:"Uygulandı", DRAFT:"Taslak", REJECTED:"Reddedildi", PENDING:"Bekliyor", SCHEDULED:"Planlandı", COMPLETED:"Tamamlandı", CONFIDENTIAL:"Gizli", RESTRICTED:"Kısıtlı", "HIGHLY RESTRICTED":"Yüksek kısıtlı" };
  return map[value.trim().toUpperCase()] ?? value;
}
function localEvent(locale: Locale, value: string) {
  if (locale !== "tr") return value;
  const map: Record<string,string> = { HIRED:"İşe alındı", POSITION_CHANGED:"Pozisyon değişti", MANAGER_CHANGED:"Yönetici değişti", COMPENSATION_CHANGED:"Ücret değişti", TERMINATED:"İşten ayrıldı", PROMOTED:"Terfi", TRANSFERRED:"Transfer" };
  return map[value.trim().toUpperCase().replaceAll(" ","_")] ?? value;
}
function Stat({ label, value, meta, icon: Icon }: { label: string; value: string; meta: string; icon: ComponentType<{ size?: number }> }) { return <div className="enterprise-stat"><div className="enterprise-stat-icon"><Icon size={17}/></div><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>; }
function EmptyRow({ message, colSpan }: { message: string; colSpan: number }) { return <tr><td colSpan={colSpan} style={{ textAlign: "center", padding: "28px" }}>{message}</td></tr>; }
function AccessDenied({ title, detail }: { title: string; detail: string }) { return <div className="card employee-restricted-card"><LockKeyhole size={22}/><div><h3>{title}</h3><p>{detail}</p></div></div>; }
function formatMoney(locale: Locale, currency: string, amount: string) { const value = Number(amount); if (!Number.isFinite(value)) return `${currency} ${amount}`; try { return new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value); } catch { return `${currency} ${value.toLocaleString(locale === "tr" ? "tr-TR" : "en-US", { maximumFractionDigits: 0 })}`; } }
function resolveVisibleColumns(options: { value: string }[], requested: string[], customized: boolean) {
  const allowed = new Set(options.map((option) => option.value));
  return new Set(customized ? requested.filter((value) => allowed.has(value)) : options.map((option) => option.value));
}
const employeeTabs = new Set(["overview", "employment", "compensation", "documents", "history"]);

export async function CoreHRLiveWorkspace({ slug, query = "", status, columns = [], columnsCustomized = false, density = "comfortable", sortKey, sortDirection = "asc", page = 1, pageSize = 50, personId, tab }: { slug: string; query?: string; status?: string; columns?: string[]; columnsCustomized?: boolean; density?: "comfortable" | "compact"; sortKey?: string; sortDirection?: "asc" | "desc"; page?: number; pageSize?: 25 | 50 | 100; personId?: string; tab?: string }) {
  const [ctx, locale] = await Promise.all([getServerRequestContext(), getServerLocale()]);
  const tenantId = ctx?.tenantId;

  if (slug === "people") {
    if (ctx && !can(ctx, "people:read")) return <AccessDenied title={c(locale,"People directory restricted","Çalışan dizini kısıtlı")} detail={c(locale,"Your current role does not include people:read access.","Mevcut rolünüz people:read erişimini içermiyor.")}/>;
    const currentView = sanitizeEnterpriseViewState("people", { query, status, columns, columnsCustomized, density, sortKey, sortDirection, pageSize });
    const [data, savedViews] = await Promise.all([
      getPeopleWorkspaceData(currentView.query, tenantId, currentView.status, currentView.sortKey, currentView.sortDirection, page, currentView.pageSize),
      ctx ? listSavedEnterpriseViews(ctx, "people") : Promise.resolve([])
    ]);
    const peopleStatusOptions = [
      { value: "ACTIVE", label: c(locale,"Active","Aktif") },
      { value: "PREBOARDING", label: c(locale,"Preboarding","İşe başlamadan önce") },
      { value: "LEAVE", label: c(locale,"On leave","İzinde") }
    ];
    const peopleColumnOptions = [
      { value: "position", label: c(locale,"Position","Pozisyon") },
      { value: "department", label: c(locale,"Department","Departman") },
      { value: "location", label: c(locale,"Location","Lokasyon") },
      { value: "status", label: c(locale,"Status","Durum") },
      { value: "start", label: c(locale,"Start date","Başlangıç") }
    ];
    const peopleSortOptions = [
      { value: "name", label: c(locale,"Name","Ad") },
      { value: "employeeNumber", label: c(locale,"Employee ID","Çalışan no") }
    ];
    const visiblePeopleColumns = resolveVisibleColumns(peopleColumnOptions, currentView.columns, currentView.columnsCustomized);
    return <><div className="enterprise-stats"><Stat label={c(locale,"Active workers","Aktif çalışanlar")} value={String(data.active)} meta={c(locale,"Current employment records","Mevcut istihdam kayıtları")} icon={UsersRound}/><Stat label={c(locale,"Preboarding","İşe başlamadan önce")} value={String(data.preboarding)} meta={c(locale,"Accepted future starters","Kabul edilmiş gelecek başlangıçlar")} icon={UserCheck}/><Stat label={c(locale,"On leave","İzinde")} value={String(data.onLeave)} meta={c(locale,"Current leave status","Mevcut izin durumu")} icon={Clock3}/><Stat label={c(locale,"Data quality","Veri kalitesi")} value={`${data.dataQuality.toFixed(1)}%`} meta={c(locale,`${data.needsReview} records need review`,`${data.needsReview} kayıt inceleme bekliyor`)} icon={BadgeCheck}/></div><EnterpriseViewToolbar
      moduleKey="people"
      basePath="/module/people"
      locale={locale}
      query={currentView.query}
      status={currentView.status}
      statusOptions={peopleStatusOptions}
      columnOptions={peopleColumnOptions}
      columns={currentView.columns}
      columnsCustomized={currentView.columnsCustomized}
      density={currentView.density}
      sortOptions={peopleSortOptions}
      sortKey={currentView.sortKey}
      sortDirection={currentView.sortDirection}
      pageSize={currentView.pageSize}
      savedViews={savedViews}
      shownCount={data.people.length}
      totalCount={data.filteredTotal}
      searchPlaceholder={c(locale,"Search name, employee ID or work email…","Ad, çalışan no veya iş e-postasında ara…")}
    /><div className={`card enterprise-table-card enterprise-density-${currentView.density}`}><div className="table-title"><div><h3>{c(locale,"People directory","Çalışan dizini")}</h3><p>{c(locale,"Live golden employee records from PostgreSQL with current effective-dated assignment.","PostgreSQL'den güncel, geçerlilik tarihli atamalarla canlı çalışan ana kayıtları.")}</p></div><span>{c(locale,`${data.filteredTotal} matched`,`${data.filteredTotal} eşleşme`)}</span></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>{c(locale,"Employee","Çalışan")}</th>{visiblePeopleColumns.has("position") ? <th>{c(locale,"Position","Pozisyon")}</th> : null}{visiblePeopleColumns.has("department") ? <th>{c(locale,"Department","Departman")}</th> : null}{visiblePeopleColumns.has("location") ? <th>{c(locale,"Location","Lokasyon")}</th> : null}{visiblePeopleColumns.has("status") ? <th>{c(locale,"Status","Durum")}</th> : null}{visiblePeopleColumns.has("start") ? <th>{c(locale,"Start date","Başlangıç")}</th> : null}<th/></tr></thead><tbody>{data.people.length ? data.people.map((person) => <tr key={person.id}><td><div className="enterprise-person"><span>{person.initials}</span><div><strong>{person.name}</strong><small>{person.employeeNumber} · {person.workEmail}</small></div></div></td>{visiblePeopleColumns.has("position") ? <td><strong className="cell-strong">{person.position}</strong><small className="cell-sub">{person.positionCode}</small></td> : null}{visiblePeopleColumns.has("department") ? <td>{person.department}</td> : null}{visiblePeopleColumns.has("location") ? <td>{person.location}</td> : null}{visiblePeopleColumns.has("status") ? <td><em className={`pill ${person.status.toLowerCase().replaceAll(" ", "-")}`}>{localStatus(locale,person.status)}</em></td> : null}{visiblePeopleColumns.has("start") ? <td>{person.startDate}</td> : null}<td><Link className="row-action" href={`/module/employee-360?person=${encodeURIComponent(person.id)}`} aria-label={c(locale,`Open ${person.name}`,`${person.name} kaydını aç`)}><ChevronRight size={15}/></Link></td></tr>) : <EmptyRow message={c(locale,"No people match this search.","Bu aramayla eşleşen çalışan bulunamadı.")} colSpan={2 + visiblePeopleColumns.size}/>}</tbody></table></div><EnterprisePagination locale={locale} moduleKey="people" state={currentView} page={data.page} pageCount={data.pageCount} totalCount={data.filteredTotal} shownCount={data.people.length}/></div></>;
  }

  if (slug === "organization") {
    if (ctx && !can(ctx, "organization:read")) return <AccessDenied title={c(locale,"Organization restricted","Organizasyon kısıtlı")} detail={c(locale,"Your current role does not include organization:read access.","Mevcut rolünüz organization:read erişimini içermiyor.")}/>;
    const data = await getOrganizationWorkspaceData(tenantId);
    return <><div className="enterprise-stats"><Stat label={c(locale,"Legal entities","Tüzel kişilikler")} value={String(data.legalEntities)} meta={c(locale,"Current effective records","Güncel geçerli kayıtlar")} icon={Building2}/><Stat label={c(locale,"Organization units","Organizasyon birimleri")} value={String(data.organizationUnits)} meta={c(locale,"Effective-dated hierarchy","Geçerlilik tarihli hiyerarşi")} icon={Network}/><Stat label={c(locale,"Filled positions","Dolu pozisyonlar")} value={String(data.filledPositions)} meta={c(locale,"Budgeted seats occupied","Bütçelenmiş kadrolar dolu")} icon={UsersRound}/><Stat label={c(locale,"Vacant positions","Boş pozisyonlar")} value={String(data.vacantPositions)} meta={c(locale,"Available for hiring","İşe alıma uygun")} icon={CircleAlert}/></div><div className="org-layout"><div className="card org-tree"><div className="table-title"><div><h3>{c(locale,"Organization model","Organizasyon modeli")}</h3><p>{c(locale,"Live hierarchy from the system of record.","Kayıt sisteminden canlı hiyerarşi.")}</p></div><span className="secondary-button module-state-badge">{c(locale,"Current hierarchy","Güncel hiyerarşi")}</span></div><div className="org-nodes">{data.units.map((unit) => <div className={`org-node level-${Math.min(unit.depth, 2)}`} key={unit.id}><div className="org-node-icon"><Building2 size={16}/></div><div><strong>{unit.name}</strong><small>{unit.type} · {unit.code}</small></div><div className="org-node-count"><strong>{unit.people}</strong><small>{locale === "tr" ? `${unit.people} çalışan · ${unit.positions} pozisyon` : `${unit.people === 1 ? "person" : "people"} · ${unit.positions} positions`}</small></div></div>)}</div></div><div className="card org-insight"><div className="table-title"><div><h3>{c(locale,"Structure health","Yapı sağlığı")}</h3><p>{c(locale,"Governed organization signals","Yönetişim kontrollü organizasyon sinyalleri")}</p></div></div><div className="health-list"><div><span>{c(locale,"Effective-dated units","Geçerlilik tarihli birimler")}</span><strong>{data.organizationUnits}</strong></div><div><span>{c(locale,"Filled positions","Dolu pozisyonlar")}</span><strong>{data.filledPositions}</strong></div><div><span>{c(locale,"Vacant positions","Boş pozisyonlar")}</span><strong>{data.vacantPositions}</strong></div><div><span>{c(locale,"Hierarchy source","Hiyerarşi kaynağı")}</span><strong>PostgreSQL</strong></div></div><div className="governance-note"><ShieldCheck size={17}/><p>{c(locale,"Organization changes preserve historical truth. Approved changes create new effective-dated records instead of overwriting previous organizational state.","Organizasyon değişiklikleri tarihsel doğruluğu korur. Onaylanan değişiklikler önceki durumu ezmek yerine yeni geçerlilik tarihli kayıtlar oluşturur.")}</p></div></div></div></>;
  }

  if (slug === "positions") {
    if (ctx && !can(ctx, "positions:read")) return <AccessDenied title={c(locale,"Positions restricted","Pozisyonlar kısıtlı")} detail={c(locale,"Your current role does not include positions:read access.","Mevcut rolünüz positions:read erişimini içermiyor.")}/>;
    const currentView = sanitizeEnterpriseViewState("positions", { query, status, columns, columnsCustomized, density, sortKey, sortDirection, pageSize });
    const [data, savedViews] = await Promise.all([
      getPositionsWorkspaceData(currentView.query, tenantId, currentView.status, currentView.sortKey, currentView.sortDirection, page, currentView.pageSize),
      ctx ? listSavedEnterpriseViews(ctx, "positions") : Promise.resolve([])
    ]);
    const positionStatusOptions = [
      { value: "OPEN", label: c(locale,"Open","Açık") },
      { value: "PLANNED", label: c(locale,"Planned","Planlandı") },
      { value: "FILLED", label: c(locale,"Filled","Dolu") },
      { value: "FROZEN", label: c(locale,"Frozen","Donduruldu") },
      { value: "CLOSED", label: c(locale,"Closed","Kapalı") }
    ];
    const positionColumnOptions = [
      { value: "organization", label: c(locale,"Organization","Organizasyon") },
      { value: "grade", label: c(locale,"Grade","Seviye") },
      { value: "location", label: c(locale,"Location","Lokasyon") },
      { value: "incumbent", label: c(locale,"Incumbent","Mevcut çalışan") },
      { value: "status", label: c(locale,"Status","Durum") },
      { value: "critical", label: c(locale,"Critical","Kritik") }
    ];
    const positionSortOptions = [
      { value: "code", label: c(locale,"Position code","Pozisyon kodu") },
      { value: "title", label: c(locale,"Title","Unvan") },
      { value: "status", label: c(locale,"Status","Durum") },
      { value: "critical", label: c(locale,"Criticality","Kritiklik") }
    ];
    const visiblePositionColumns = resolveVisibleColumns(positionColumnOptions, currentView.columns, currentView.columnsCustomized);
    const canBulkManagePositions = !!ctx && can(ctx, "positions:write");
    return <><div className="enterprise-stats"><Stat label={c(locale,"Positions","Pozisyonlar")} value={String(data.positions)} meta={c(locale,`${data.filled} filled`,`${data.filled} dolu`)} icon={BriefcaseBusiness}/><Stat label={c(locale,"Open","Açık")} value={String(data.open)} meta={c(locale,"Available for recruiting","İşe alıma uygun")} icon={CircleAlert}/><Stat label={c(locale,"Planned","Planlanan")} value={String(data.planned)} meta={c(locale,"Future workforce plan","Gelecek iş gücü planı")} icon={Clock3}/><Stat label={c(locale,"Critical roles","Kritik roller")} value={String(data.critical)} meta={c(locale,"Business continuity scoped","İş sürekliliği kapsamında")} icon={ShieldCheck}/></div><EnterpriseViewToolbar
      moduleKey="positions"
      basePath="/module/positions"
      locale={locale}
      query={currentView.query}
      status={currentView.status}
      statusOptions={positionStatusOptions}
      columnOptions={positionColumnOptions}
      columns={currentView.columns}
      columnsCustomized={currentView.columnsCustomized}
      density={currentView.density}
      sortOptions={positionSortOptions}
      sortKey={currentView.sortKey}
      sortDirection={currentView.sortDirection}
      pageSize={currentView.pageSize}
      savedViews={savedViews}
      shownCount={data.rows.length}
      totalCount={data.filteredTotal}
      searchPlaceholder={c(locale,"Search code, title, organization or location…","Kod, unvan, organizasyon veya lokasyonda ara…")}
    /><PositionBulkActionForm locale={locale} enabled={canBulkManagePositions}><div className={`card enterprise-table-card enterprise-density-${currentView.density}`}><div className="table-title"><div><h3>{c(locale,"Position register","Pozisyon envanteri")}</h3><p>{c(locale,"Live budgeted seats exist independently from incumbents.","Bütçelenmiş kadrolar mevcut çalışanlardan bağımsız olarak yönetilir.")}</p></div><span>{c(locale,`${data.filteredTotal} matched`,`${data.filteredTotal} eşleşme`)}</span></div><div className="table-wrap"><table className="enterprise-table"><thead><tr>{canBulkManagePositions ? <th className="position-bulk-select"><input type="checkbox" data-position-select-all aria-label={c(locale,"Select all visible positions","Görünen tüm pozisyonları seç")}/></th> : null}<th>{c(locale,"Position","Pozisyon")}</th>{visiblePositionColumns.has("organization") ? <th>{c(locale,"Organization","Organizasyon")}</th> : null}{visiblePositionColumns.has("grade") ? <th>{c(locale,"Grade","Seviye")}</th> : null}{visiblePositionColumns.has("location") ? <th>{c(locale,"Location","Lokasyon")}</th> : null}{visiblePositionColumns.has("incumbent") ? <th>{c(locale,"Incumbent","Mevcut çalışan")}</th> : null}{visiblePositionColumns.has("status") ? <th>{c(locale,"Status","Durum")}</th> : null}{visiblePositionColumns.has("critical") ? <th>{c(locale,"Critical","Kritik")}</th> : null}</tr></thead><tbody>{data.rows.length ? data.rows.map((position) => <tr key={position.id}>{canBulkManagePositions ? <td className="position-bulk-select"><input type="checkbox" name="positionIds" value={position.id} aria-label={c(locale,`Select ${position.title}`,`${position.title} pozisyonunu seç`)}/></td> : null}<td><strong className="cell-strong">{position.title}</strong><small className="cell-sub">{position.code}</small></td>{visiblePositionColumns.has("organization") ? <td>{position.org}</td> : null}{visiblePositionColumns.has("grade") ? <td>{position.grade}</td> : null}{visiblePositionColumns.has("location") ? <td>{position.location}</td> : null}{visiblePositionColumns.has("incumbent") ? <td>{position.incumbent}</td> : null}{visiblePositionColumns.has("status") ? <td><em className={`pill ${position.status.toLowerCase().replaceAll(" ", "-")}`}>{localStatus(locale,position.status)}</em></td> : null}{visiblePositionColumns.has("critical") ? <td>{position.critical ? <span className="critical-badge"><ShieldCheck size={13}/> {c(locale,"Yes","Evet")}</span> : "—"}</td> : null}</tr>) : <EmptyRow message={c(locale,"No positions are configured.","Tanımlı pozisyon bulunmuyor.")} colSpan={1 + visiblePositionColumns.size + (canBulkManagePositions ? 1 : 0)}/>}</tbody></table></div><EnterprisePagination locale={locale} moduleKey="positions" state={currentView} page={data.page} pageCount={data.pageCount} totalCount={data.filteredTotal} shownCount={data.rows.length}/></div></PositionBulkActionForm></>;
  }

  if (slug === "employee-360") {
    if (ctx && !can(ctx, "people:read")) return <AccessDenied title={c(locale,"Employee 360 restricted","Çalışan 360 kısıtlı")} detail={c(locale,"Your current role does not include people:read access.","Mevcut rolünüz people:read erişimini içermiyor.")}/>;
    const canReadCompensation = !!ctx && can(ctx, "compensation:read");
    const canWriteCompensation = !!ctx && can(ctx, "compensation:write");
    const canReadDocuments = !!ctx && can(ctx, "documents:read");
    const canWritePeople = !!ctx && can(ctx, "people:write");
    const person = await getEmployee360Data(personId, { tenantId, includeCompensation: canReadCompensation, includeDocuments: canReadDocuments, includeManagerOptions: canWritePeople });
    if (!person) return <div className="card"><div className="empty-state"><h3>{c(locale,"No employee record found","Çalışan kaydı bulunamadı")}</h3><p>{c(locale,"Select a person from the People directory.","Çalışan dizininden bir kişi seçin.")}</p><Link className="secondary-button" href="/module/people">{c(locale,"Open People","Çalışanları aç")}</Link></div></div>;
    const activeTab = tab && employeeTabs.has(tab) ? tab : "overview";
    const currentCompensation = person.compensationHistory[0];
    const tabs = [
      { value: "overview", label: c(locale,"Overview","Genel Bakış") },
      { value: "employment", label: c(locale,"Employment","İstihdam") },
      { value: "compensation", label: c(locale,"Compensation","Ücret") },
      { value: "documents", label: c(locale,"Documents","Dokümanlar") },
      { value: "history", label: c(locale,"History","Geçmiş") }
    ];
    const activeTabLabel = tabs.find((item) => item.value === activeTab)?.label ?? tabs[0].label;

    return <div className="employee-360-layout">
      <Employee360Rail
        locale={locale}
        person={{
          id: person.id,
          initials: person.initials,
          name: person.name,
          employeeNumber: person.employeeNumber,
          position: person.position,
          positionCode: person.positionCode,
          department: person.department,
          location: person.location,
          manager: person.manager,
          workEmail: person.workEmail,
          status: localStatus(locale, person.status),
          classification: localStatus(locale, person.classification),
          criticalPosition: person.criticalPosition
        }}
        activeTab={activeTab}
        tabs={tabs}
        canReadCompensation={canReadCompensation}
        canReadDocuments={canReadDocuments}
      />
      <main className="employee-360-main">
        <section className="employee-360-main-head">
          <div><span className="section-kicker">{activeTabLabel}</span><h2>{person.name}</h2><p>{person.position} · {person.department}</p></div>
          <em className={`pill ${person.status.toLowerCase().replaceAll(" ", "-")}`}>{localStatus(locale,person.status)}</em>
        </section>

    {activeTab === "overview" ? <div className="profile-grid"><div className="card profile-card"><div className="table-title"><div><h3>{c(locale,"Employment","İstihdam")}</h3><p>{c(locale,"Current effective record","Güncel geçerli kayıt")}</p></div></div><dl><div><dt>{c(locale,"Position","Pozisyon")}</dt><dd>{person.position}</dd></div><div><dt>{c(locale,"Department","Departman")}</dt><dd>{person.department}</dd></div><div><dt>{c(locale,"Job family","İş ailesi")}</dt><dd>{person.jobFamily}</dd></div><div><dt>{c(locale,"Grade","Seviye")}</dt><dd>{person.grade}</dd></div><div><dt>{c(locale,"Start date","Başlangıç tarihi")}</dt><dd>{person.startDate}</dd></div><div><dt>{c(locale,"Manager","Yönetici")}</dt><dd>{person.manager}</dd></div><div><dt>{c(locale,"Direct reports","Doğrudan bağlı çalışanlar")}</dt><dd>{person.directReports}</dd></div></dl></div><div className="card profile-card"><div className="table-title"><div><h3>{c(locale,"Lifecycle","Yaşam döngüsü")}</h3><p>{c(locale,"Immutable effective-dated business history","Değiştirilemez, geçerlilik tarihli iş geçmişi")}</p></div></div><div className="profile-timeline">{person.lifecycle.slice(0, 7).map((event) => <div key={event.id}><i/><span><strong>{localEvent(locale,event.type)}{event.scheduled ? c(locale," · Scheduled"," · Planlandı") : ""}</strong><small>{event.summary} · {event.date}</small></span></div>)}</div></div><div className="card profile-card security-card"><div className="table-title"><div><h3>{c(locale,"Data access","Veri erişimi")}</h3><p>{c(locale,"Classification & policy context","Sınıflandırma & politika bağlamı")}</p></div></div><div className="security-status"><ShieldCheck size={20}/><div><strong>{localStatus(locale,person.classification)}</strong><small>{c(locale,"Golden employee record","Çalışan ana kaydı")}</small></div></div><div className="mini-policy"><span>{c(locale,"Compensation","Ücret")}</span><strong>{canReadCompensation ? c(locale,"Authorized","Yetkili") : c(locale,"Restricted","Kısıtlı")}</strong></div><div className="mini-policy"><span>{c(locale,"Documents","Dokümanlar")}</span><strong>{canReadDocuments ? c(locale,"Authorized","Yetkili") : c(locale,"Restricted","Kısıtlı")}</strong></div><div className="mini-policy"><span>{c(locale,"ER cases","Çalışan ilişkileri vakaları")}</span><strong>{c(locale,"Case wall","Vaka duvarı")}</strong></div><div className="mini-policy"><span>{c(locale,"Audit logging","Denetim kaydı")}</span><strong>{c(locale,"Enabled","Aktif")}</strong></div></div></div> : null}

    {activeTab === "employment" ? <div className="employee-detail-stack"><div className="profile-grid two-column"><div className="card profile-card"><div className="table-title"><div><h3>{c(locale,"Current employment","Mevcut istihdam")}</h3><p>{c(locale,"Effective relationship and job architecture","Geçerli ilişki ve iş mimarisi")}</p></div></div><dl><div><dt>{c(locale,"Employment ID","İstihdam ID")}</dt><dd>{person.employmentId ?? "—"}</dd></div><div><dt>{c(locale,"Status","Durum")}</dt><dd>{localStatus(locale,person.status)}</dd></div><div><dt>{c(locale,"Start / end","Başlangıç / bitiş")}</dt><dd>{person.startDate} → {person.endDate}</dd></div><div><dt>{c(locale,"Position","Pozisyon")}</dt><dd>{person.position} · {person.positionCode}</dd></div><div><dt>{c(locale,"Job family / grade","İş ailesi / seviye")}</dt><dd>{person.jobFamily} · {person.grade}</dd></div><div><dt>{c(locale,"Organization","Organizasyon")}</dt><dd>{person.department} · {person.organizationType}</dd></div><div><dt>{c(locale,"Manager","Yönetici")}</dt><dd>{person.manager}</dd></div></dl></div><div className="card profile-card"><div className="table-title"><div><h3>{c(locale,"Work pattern","Çalışma düzeni")}</h3><p>{c(locale,"Effective work schedule","Geçerli çalışma planı")}</p></div></div><dl>{person.workSchedule ? <><div><dt>{c(locale,"Schedule","Plan")}</dt><dd>{person.workSchedule.name} · {person.workSchedule.code}</dd></div><div><dt>{c(locale,"Weekly hours","Haftalık saat")}</dt><dd>{person.workSchedule.weeklyHours}</dd></div><div><dt>{c(locale,"Timezone","Saat dilimi")}</dt><dd>{person.workSchedule.timezone}</dd></div></> : <div><dt>{c(locale,"Schedule","Plan")}</dt><dd>{c(locale,"Not assigned","Atanmadı")}</dd></div>}<div><dt>{c(locale,"Direct reports","Doğrudan bağlı çalışanlar")}</dt><dd>{person.directReports}</dd></div><div><dt>{c(locale,"Record created","Kayıt oluşturma")}</dt><dd>{person.createdAt}</dd></div><div><dt>{c(locale,"Last updated","Son güncelleme")}</dt><dd>{person.updatedAt}</dd></div></dl></div></div>{canWritePeople ? <ManagerAssignmentForm personId={person.id} currentManagerEmploymentId={person.currentManagerEmploymentId} managers={person.managerOptions}/> : null}<div className="card enterprise-table-card"><div className="table-title"><div><h3>{c(locale,"Employment history","İstihdam geçmişi")}</h3><p>{c(locale,"Previous employments are preserved rather than overwritten.","Önceki istihdam kayıtları üzerine yazılmadan korunur.")}</p></div><span>{c(locale,`${person.employmentHistory.length} records`,`${person.employmentHistory.length} kayıt`)}</span></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>{c(locale,"Position","Pozisyon")}</th><th>{c(locale,"Department","Departman")}</th><th>{c(locale,"Manager","Yönetici")}</th><th>{c(locale,"Status","Durum")}</th><th>{c(locale,"Start","Başlangıç")}</th><th>{c(locale,"End","Bitiş")}</th></tr></thead><tbody>{person.employmentHistory.length ? person.employmentHistory.map((row) => <tr key={row.id}><td><strong className="cell-strong">{row.position}</strong><small className="cell-sub">{row.positionCode}</small></td><td>{row.department}</td><td>{row.manager}</td><td><em className={`pill ${row.status.toLowerCase().replaceAll(" ", "-")}`}>{localStatus(locale,row.status)}</em></td><td>{row.startDate}</td><td>{row.endDate}</td></tr>) : <EmptyRow message={c(locale,"No employment history recorded.","İstihdam geçmişi kaydı bulunmuyor.")} colSpan={6}/>}</tbody></table></div></div></div> : null}

    {activeTab === "compensation" ? canReadCompensation ? <div className="employee-detail-stack"><div className="enterprise-stats"><Stat label={c(locale,"Current base","Mevcut baz ücret")} value={currentCompensation ? formatMoney(locale,currentCompensation.currency,currentCompensation.annualBase) : "—"} meta={c(locale,"Restricted compensation data","Kısıtlı ücret verisi")} icon={BadgeDollarSign}/><Stat label={c(locale,"History records","Geçmiş kayıtları")} value={String(person.compensationHistory.length)} meta={c(locale,"Effective-dated values","Geçerlilik tarihli değerler")} icon={History}/><Stat label={c(locale,"Change requests","Değişiklik talepleri")} value={String(person.compensationRequests.length)} meta={c(locale,"Approval-bound workflow","Onaya bağlı iş akışı")} icon={Clock3}/><Stat label={c(locale,"Access","Erişim")} value={c(locale,"Granted","Verildi")} meta="RBAC compensation:read" icon={ShieldCheck}/></div><div className="card enterprise-table-card"><div className="table-title"><div><h3>{c(locale,"Compensation history","Ücret geçmişi")}</h3><p>{c(locale,"Restricted effective-dated salary records.","Kısıtlı, geçerlilik tarihli ücret kayıtları.")}</p></div></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>{c(locale,"Annual base","Yıllık baz")}</th><th>{c(locale,"Currency","Para birimi")}</th><th>{c(locale,"Effective from","Geçerlilik başlangıcı")}</th><th>{c(locale,"Effective to","Geçerlilik bitişi")}</th></tr></thead><tbody>{person.compensationHistory.length ? person.compensationHistory.map((row) => <tr key={row.id}><td><strong className="cell-strong">{formatMoney(locale,row.currency,row.annualBase)}</strong></td><td>{row.currency}</td><td>{row.effectiveFrom}</td><td>{row.effectiveTo}</td></tr>) : <EmptyRow message={c(locale,"No compensation history is recorded.","Ücret geçmişi kaydı bulunmuyor.")} colSpan={4}/>}</tbody></table></div></div><div className="card enterprise-table-card"><div className="table-title"><div><h3>{c(locale,"Change requests","Değişiklik talepleri")}</h3><p>{c(locale,"Proposals stay separate from salary history until approved and applied.","Öneriler onaylanıp uygulanana kadar ücret geçmişinden ayrı tutulur.")}</p></div></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>{c(locale,"Proposed base","Önerilen baz")}</th><th>{c(locale,"Effective","Geçerlilik")}</th><th>{c(locale,"Status","Durum")}</th><th>{c(locale,"Reason","Gerekçe")}</th><th>{c(locale,"Requested","Talep tarihi")}</th></tr></thead><tbody>{person.compensationRequests.length ? person.compensationRequests.map((row) => <tr key={row.id}><td><strong className="cell-strong">{formatMoney(locale,row.currency,row.proposedAnnualBase)}</strong>{row.currentAnnualBase ? <small className="cell-sub">{c(locale,"From","Önceki")}: {formatMoney(locale,row.currency,row.currentAnnualBase)}</small> : null}</td><td>{row.effectiveAt}</td><td><em className={`pill ${row.status.toLowerCase().replaceAll(" ", "-")}`}>{localStatus(locale,row.status)}</em></td><td>{row.reason}</td><td>{row.createdAt}</td></tr>) : <EmptyRow message={c(locale,"No compensation changes are waiting or recorded.","Bekleyen veya kayıtlı ücret değişikliği bulunmuyor.")} colSpan={5}/>}</tbody></table></div></div>{canWriteCompensation ? <CompensationRequestForm personId={person.id} currency={currentCompensation?.currency ?? "EUR"}/> : null}</div> : <AccessDenied title={c(locale,"Compensation is restricted","Ücret bilgileri kısıtlı")} detail={c(locale,"Salary and compensation history require an authenticated role with compensation:read permission. Tenant administration alone does not grant salary access.","Ücret ve ücret geçmişi için compensation:read yetkisine sahip kimliği doğrulanmış bir rol gerekir. Yalnızca tenant yönetimi ücret erişimi sağlamaz.")}/> : null}

    {activeTab === "documents" ? canReadDocuments ? <div className="card enterprise-table-card"><div className="table-title"><div><h3>{c(locale,"Employee documents","Çalışan dokümanları")}</h3><p>{c(locale,"Metadata only. Object access remains separately policy-controlled.","Yalnızca metadata. Nesne erişimi ayrıca politika kontrollüdür.")}</p></div><span>{c(locale,`${person.documents.length} objects`,`${person.documents.length} nesne`)}</span></div><div className="table-wrap"><table className="enterprise-table"><thead><tr><th>{c(locale,"Document","Doküman")}</th><th>{c(locale,"Purpose","Amaç")}</th><th>{c(locale,"Classification","Sınıflandırma")}</th><th>{c(locale,"Status","Durum")}</th><th>{c(locale,"Created","Oluşturma")}</th><th>{c(locale,"Retention / expiry","Saklama / son kullanma")}</th></tr></thead><tbody>{person.documents.length ? person.documents.map((document) => <tr key={document.id}><td><span className="document-name"><FileText size={15}/><strong>{document.fileName}</strong></span><small className="cell-sub">{document.contentType}</small></td><td>{document.purpose}</td><td><em className={`classification ${document.classification.toLowerCase().replaceAll(" ", "-")}`}>{localStatus(locale,document.classification)}</em></td><td>{localStatus(locale,document.status)}</td><td>{document.createdAt}</td><td>{document.retentionUntil}<small className="cell-sub">{c(locale,"Expires","Son kullanma")}: {document.expiresAt}</small></td></tr>) : <EmptyRow message={c(locale,"No employee documents are stored.","Saklanan çalışan dokümanı bulunmuyor.")} colSpan={6}/>}</tbody></table></div></div> : <AccessDenied title={c(locale,"Documents are restricted","Dokümanlar kısıtlı")} detail={c(locale,"Employee document metadata requires an authenticated role with documents:read permission. Object download remains a separate authorization decision.","Çalışan doküman metadatası documents:read yetkisine sahip kimliği doğrulanmış bir rol gerektirir. Nesne indirme ayrı bir yetkilendirme kararıdır.")}/> : null}

    {activeTab === "history" ? <div className="card profile-card employee-history-card"><div className="table-title"><div><h3>{c(locale,"Employee lifecycle ledger","Çalışan yaşam döngüsü kaydı")}</h3><p>{c(locale,"Effective-dated events provide a durable career timeline.","Geçerlilik tarihli olaylar kalıcı bir kariyer zaman çizelgesi sağlar.")}</p></div><span>{c(locale,`${person.lifecycle.length} events`,`${person.lifecycle.length} olay`)}</span></div><div className="profile-timeline">{person.lifecycle.length ? person.lifecycle.map((event) => <div key={event.id}><i/><span><strong>{localEvent(locale,event.type)}{event.scheduled ? c(locale," · Scheduled"," · Planlandı") : ""}</strong><small>{event.summary} · {event.date}</small></span></div>) : <p className="employee-empty-copy">{c(locale,"No lifecycle events recorded yet.","Henüz yaşam döngüsü olayı kaydedilmedi.")}</p>}</div></div> : null}</main></div>;
  }
  return null;
}

export const liveCoreWorkspaceSlugs = new Set(["people", "organization", "positions", "employee-360"]);
