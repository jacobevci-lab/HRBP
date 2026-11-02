import Link from "next/link";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { Locale } from "@/lib/i18n";

export type EnterpriseViewOption = { value: string; label: string };

export function EnterpriseViewToolbar({
  basePath,
  locale,
  query,
  status,
  statusOptions,
  shownCount,
  totalCount,
  searchPlaceholder
}: {
  basePath: string;
  locale: Locale;
  query: string;
  status?: string;
  statusOptions: EnterpriseViewOption[];
  shownCount: number;
  totalCount: number;
  searchPlaceholder: string;
}) {
  const tr = locale === "tr";
  const filtered = Boolean(query || status);
  return <form className="enterprise-view-toolbar" action={basePath} method="get">
    <label className="enterprise-view-search">
      <Search size={16}/>
      <input name="q" defaultValue={query} maxLength={160} placeholder={searchPlaceholder} aria-label={tr ? "Tabloda ara" : "Search table"}/>
    </label>
    <label className="enterprise-view-filter">
      <SlidersHorizontal size={14}/>
      <select name="status" defaultValue={status ?? ""} aria-label={tr ? "Durum filtresi" : "Status filter"}>
        <option value="">{tr ? "Tüm durumlar" : "All statuses"}</option>
        {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    <button className="secondary-button" type="submit">{tr ? "Uygula" : "Apply"}</button>
    {filtered ? <Link className="secondary-button" href={basePath}><X size={14}/>{tr ? "Sıfırla" : "Reset"}</Link> : null}
    <span className="enterprise-view-count">{totalCount === shownCount
      ? (tr ? `${shownCount} kayıt` : `${shownCount} records`)
      : (tr ? `${shownCount} / ${totalCount} gösteriliyor` : `${shownCount} / ${totalCount} shown`)}</span>
  </form>;
}
