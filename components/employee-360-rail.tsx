import Link from "next/link";
import { BriefcaseBusiness, ChevronLeft, FileText, LockKeyhole, MapPin, ShieldCheck, UserRound } from "lucide-react";
import type { Locale } from "@/lib/i18n";

type Tab = { value: string; label: string };

export function Employee360Rail({
  locale,
  person,
  activeTab,
  tabs,
  canReadCompensation,
  canReadDocuments
}: {
  locale: Locale;
  person: {
    id: string;
    initials: string;
    name: string;
    employeeNumber: string;
    position: string;
    positionCode: string;
    department: string;
    location: string;
    manager: string;
    workEmail: string;
    status: string;
    classification: string;
    criticalPosition: boolean;
  };
  activeTab: string;
  tabs: Tab[];
  canReadCompensation: boolean;
  canReadDocuments: boolean;
}) {
  const tr = locale === "tr";
  const tabHref = (value: string) => `/module/employee-360?person=${encodeURIComponent(person.id)}&tab=${value}`;

  return <aside className="employee-360-rail card">
    <Link className="employee-360-back" href="/module/people"><ChevronLeft size={14}/>{tr ? "Çalışanlara dön" : "Back to People"}</Link>
    <div className="employee-360-rail-identity">
      <div className="employee-avatar">{person.initials}</div>
      <div><span className="section-kicker">{person.employeeNumber}</span><h2>{person.name}</h2><p>{person.position}</p></div>
    </div>
    <div className="employee-360-rail-meta">
      <div><BriefcaseBusiness size={14}/><span><small>{tr ? "Organizasyon" : "Organization"}</small><strong>{person.department}</strong></span></div>
      <div><MapPin size={14}/><span><small>{tr ? "Lokasyon" : "Location"}</small><strong>{person.location}</strong></span></div>
      <div><UserRound size={14}/><span><small>{tr ? "Yönetici" : "Manager"}</small><strong>{person.manager}</strong></span></div>
      <div><FileText size={14}/><span><small>{tr ? "İş e-postası" : "Work email"}</small><strong>{person.workEmail}</strong></span></div>
    </div>

    <nav className="employee-360-rail-nav" aria-label={tr ? "Çalışan 360 bölümleri" : "Employee 360 sections"}>
      {tabs.map((tab) => <Link key={tab.value} href={tabHref(tab.value)} className={activeTab === tab.value ? "active" : ""}>
        <span>{tab.label}</span><small>{activeTab === tab.value ? (tr ? "Açık" : "Current") : ""}</small>
      </Link>)}
    </nav>

    <div className="employee-360-access">
      <div><ShieldCheck size={14}/><span><small>{tr ? "Kayıt durumu" : "Record status"}</small><strong>{person.status}</strong></span></div>
      <div><LockKeyhole size={14}/><span><small>{tr ? "Sınıflandırma" : "Classification"}</small><strong>{person.classification}</strong></span></div>
      <div className="employee-360-access-line"><span>{tr ? "Ücret" : "Compensation"}</span><strong>{canReadCompensation ? (tr ? "Yetkili" : "Authorized") : (tr ? "Kısıtlı" : "Restricted")}</strong></div>
      <div className="employee-360-access-line"><span>{tr ? "Dokümanlar" : "Documents"}</span><strong>{canReadDocuments ? (tr ? "Yetkili" : "Authorized") : (tr ? "Kısıtlı" : "Restricted")}</strong></div>
      {person.criticalPosition ? <div className="employee-360-critical"><ShieldCheck size={13}/>{tr ? "Kritik pozisyon" : "Critical position"}</div> : null}
    </div>
  </aside>;
}
