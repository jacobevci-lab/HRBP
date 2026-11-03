import Link from "next/link";
import { ArrowUpDown, Columns3, List, Search, SlidersHorizontal, X } from "lucide-react";
import { EnterpriseSavedViews } from "@/components/enterprise-saved-views";
import type { Locale } from "@/lib/i18n";
import type {
  EnterpriseViewModule,
  SavedEnterpriseViewSummary
} from "@/lib/enterprise-saved-views";

export type EnterpriseViewOption = { value: string; label: string };

export function EnterpriseViewToolbar({
  moduleKey,
  basePath,
  locale,
  query,
  status,
  statusOptions,
  columnOptions,
  columns,
  columnsCustomized,
  density,
  sortOptions,
  sortKey,
  sortDirection,
  savedViews,
  shownCount,
  totalCount,
  searchPlaceholder
}: {
  moduleKey: EnterpriseViewModule;
  basePath: string;
  locale: Locale;
  query: string;
  status?: string;
  statusOptions: EnterpriseViewOption[];
  columnOptions: EnterpriseViewOption[];
  columns: string[];
  columnsCustomized: boolean;
  density: "comfortable" | "compact";
  sortOptions: EnterpriseViewOption[];
  sortKey?: string;
  sortDirection: "asc" | "desc";
  savedViews: SavedEnterpriseViewSummary[];
  shownCount: number;
  totalCount: number;
  searchPlaceholder: string;
}) {
  const tr = locale === "tr";
  const selectedColumns = new Set(columns);
  const filtered = Boolean(query || status || columnsCustomized || density === "compact" || sortKey);
  const current = { query, status, columns, columnsCustomized, density, sortKey, sortDirection };

  return <div className="enterprise-view-toolbar">
    <form className="enterprise-view-controls" action={basePath} method="get">
      <input type="hidden" name="columnsMode" value="custom"/>
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
      <details className="enterprise-column-picker">
        <summary><Columns3 size={14}/><span>{tr ? "Sütunlar" : "Columns"}</span><small>{columnsCustomized ? selectedColumns.size : columnOptions.length}/{columnOptions.length}</small></summary>
        <div className="enterprise-column-options">
          <strong>{tr ? "Görünür sütunlar" : "Visible columns"}</strong>
          {columnOptions.map((option) => <label key={option.value}><input type="checkbox" name="columns" value={option.value} defaultChecked={!columnsCustomized || selectedColumns.has(option.value)}/><span>{option.label}</span></label>)}
          <small>{tr ? "Ana kayıt sütunu her zaman görünür." : "The primary record column is always visible."}</small>
        </div>
      </details>
      <label className="enterprise-view-density">
        <List size={14}/>
        <select name="density" defaultValue={density} aria-label={tr ? "Tablo yoğunluğu" : "Table density"}>
          <option value="comfortable">{tr ? "Rahat" : "Comfortable"}</option>
          <option value="compact">{tr ? "Kompakt" : "Compact"}</option>
        </select>
      </label>
      <label className="enterprise-view-sort">
        <ArrowUpDown size={14}/>
        <select name="sort" defaultValue={sortKey ?? ""} aria-label={tr ? "Sıralama alanı" : "Sort field"}>
          <option value="">{tr ? "Varsayılan sıra" : "Default order"}</option>
          {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select name="dir" defaultValue={sortDirection} aria-label={tr ? "Sıralama yönü" : "Sort direction"}>
          <option value="asc">{tr ? "Artan ↑" : "Ascending ↑"}</option>
          <option value="desc">{tr ? "Azalan ↓" : "Descending ↓"}</option>
        </select>
      </label>
      <button className="secondary-button" type="submit">{tr ? "Uygula" : "Apply"}</button>
      {filtered ? <Link className="secondary-button" href={basePath}><X size={14}/>{tr ? "Sıfırla" : "Reset"}</Link> : null}
    </form>

    <EnterpriseSavedViews locale={locale} moduleKey={moduleKey} current={current} savedViews={savedViews}/>

    <span className="enterprise-view-count">{totalCount === shownCount
      ? (tr ? `${shownCount} kayıt` : `${shownCount} records`)
      : (tr ? `${shownCount} / ${totalCount} gösteriliyor` : `${shownCount} / ${totalCount} shown`)}</span>
  </div>;
}
