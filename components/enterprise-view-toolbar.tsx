import Link from "next/link";
import { ArrowUpDown, Download, List, Search, SlidersHorizontal, X } from "lucide-react";
import { EnterpriseSavedViews } from "@/components/enterprise-saved-views";
import { EnterpriseColumnPicker, type EnterpriseColumnOption } from "@/components/enterprise-column-picker";
import { EnterpriseCopyViewLink } from "@/components/enterprise-copy-view-link";
import type { Locale } from "@/lib/i18n";
import {
  buildEnterpriseViewHref,
  type EnterpriseViewModule,
  type SavedEnterpriseViewSummary
} from "@/lib/enterprise-saved-views";

export type EnterpriseViewOption = EnterpriseColumnOption;

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
  pageSize,
  savedViews,
  shownCount,
  totalCount,
  searchPlaceholder,
  exportEnabled = false
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
  pageSize: 25 | 50 | 100;
  savedViews: SavedEnterpriseViewSummary[];
  shownCount: number;
  totalCount: number;
  searchPlaceholder: string;
  exportEnabled?: boolean;
}) {
  const tr = locale === "tr";
  const filtered = Boolean(query || status || columnsCustomized || density === "compact" || sortKey || pageSize !== 50);
  const current = { query, status, columns, columnsCustomized, density, sortKey, sortDirection, pageSize };
  const exportParams = new URLSearchParams({ module: moduleKey, locale });
  if (query) exportParams.set("q", query);
  if (status) exportParams.set("status", status);
  if (columnsCustomized) {
    exportParams.set("columnsMode", "custom");
    columns.forEach((column) => exportParams.append("columns", column));
  }
  if (sortKey) exportParams.set("sort", sortKey);
  if (sortDirection === "desc") exportParams.set("dir", "desc");
  const exportHref = `/api/core-hr/export?${exportParams.toString()}`;
  const shareHref = buildEnterpriseViewHref(moduleKey, current);

  return <div className="enterprise-view-toolbar">
    <form className="enterprise-view-controls" action={basePath} method="get">
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
      <EnterpriseColumnPicker locale={locale} options={columnOptions} columns={columns} columnsCustomized={columnsCustomized}/>
      <label className="enterprise-view-density">
        <List size={14}/>
        <select name="density" defaultValue={density} aria-label={tr ? "Tablo yoğunluğu" : "Table density"}>
          <option value="comfortable">{tr ? "Rahat" : "Comfortable"}</option>
          <option value="compact">{tr ? "Kompakt" : "Compact"}</option>
        </select>
      </label>
      <label className="enterprise-view-page-size">
        <List size={14}/>
        <select name="pageSize" defaultValue={pageSize} aria-label={tr ? "Sayfa başına satır" : "Rows per page"}>
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
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

    {exportEnabled ? <a className="secondary-button enterprise-view-export" href={exportHref} title={tr ? "Filtrelenmiş görünümün tamamını CSV olarak dışa aktar" : "Export the complete filtered view as CSV"}>
      <Download size={14}/>{tr ? "CSV dışa aktar" : "Export CSV"}
    </a> : null}

    <EnterpriseCopyViewLink locale={locale} href={shareHref}/>
    <EnterpriseSavedViews locale={locale} moduleKey={moduleKey} current={current} savedViews={savedViews}/>

    <span className="enterprise-view-count">{totalCount === shownCount
      ? (tr ? `${shownCount} kayıt` : `${shownCount} records`)
      : (tr ? `${shownCount} / ${totalCount} gösteriliyor` : `${shownCount} / ${totalCount} shown`)}</span>
  </div>;
}
