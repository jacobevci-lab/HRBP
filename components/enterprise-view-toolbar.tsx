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
  savedViewId,
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
  savedViewId?: string;
  savedViews: SavedEnterpriseViewSummary[];
  shownCount: number;
  totalCount: number;
  searchPlaceholder: string;
  exportEnabled?: boolean;
}) {
  const tr = locale === "tr";
  const filtered = Boolean(query || status || columnsCustomized || density === "compact" || sortKey || pageSize !== 50);
  const current = { query, status, columns, columnsCustomized, density, sortKey, sortDirection, pageSize, savedViewId };
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
  const shareHref = buildEnterpriseViewHref(moduleKey, { ...current, savedViewId: undefined });

  const statusLabel = status ? statusOptions.find((option) => option.value === status)?.label ?? status : null;
  const sortLabel = sortKey ? sortOptions.find((option) => option.value === sortKey)?.label ?? sortKey : null;
  const queryLabel = query.length > 34 ? `${query.slice(0, 31)}…` : query;
  const activeViewChips = [
    query ? {
      key: "query",
      label: tr ? `Arama: “${queryLabel}”` : `Search: “${queryLabel}”`,
      title: tr ? `Aramayı kaldır: ${query}` : `Remove search: ${query}`,
      href: buildEnterpriseViewHref(moduleKey, { ...current, query: "" })
    } : null,
    status ? {
      key: "status",
      label: tr ? `Durum: ${statusLabel}` : `Status: ${statusLabel}`,
      title: tr ? "Durum filtresini kaldır" : "Remove status filter",
      href: buildEnterpriseViewHref(moduleKey, { ...current, status: undefined })
    } : null,
    columnsCustomized ? {
      key: "columns",
      label: tr ? `${columns.length}/${columnOptions.length} sütun` : `${columns.length}/${columnOptions.length} columns`,
      title: tr ? "Varsayılan sütunlara dön" : "Restore default columns",
      href: buildEnterpriseViewHref(moduleKey, {
        ...current,
        columns: columnOptions.map((option) => option.value),
        columnsCustomized: false
      })
    } : null,
    density === "compact" ? {
      key: "density",
      label: tr ? "Kompakt yoğunluk" : "Compact density",
      title: tr ? "Rahat yoğunluğa dön" : "Restore comfortable density",
      href: buildEnterpriseViewHref(moduleKey, { ...current, density: "comfortable" })
    } : null,
    sortKey ? {
      key: "sort",
      label: `${tr ? "Sıra" : "Sort"}: ${sortLabel} ${sortDirection === "desc" ? "↓" : "↑"}`,
      title: tr ? "Varsayılan sıralamaya dön" : "Restore default sorting",
      href: buildEnterpriseViewHref(moduleKey, { ...current, sortKey: undefined, sortDirection: "asc" })
    } : null,
    pageSize !== 50 ? {
      key: "pageSize",
      label: tr ? `${pageSize}/sayfa` : `${pageSize}/page`,
      title: tr ? "Sayfa boyutunu 50 yap" : "Restore 50 rows per page",
      href: buildEnterpriseViewHref(moduleKey, { ...current, pageSize: 50 })
    } : null
  ].filter((item): item is { key: string; label: string; title: string; href: string } => Boolean(item));

  return <div className="enterprise-view-toolbar">
    <form className="enterprise-view-controls" action={basePath} method="get">
      {savedViewId ? <input type="hidden" name="view" value={savedViewId}/> : null}
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

    <div className="enterprise-view-actions">
      {exportEnabled ? <a className="secondary-button enterprise-view-export" href={exportHref} title={tr ? "Filtrelenmiş görünümün tamamını CSV olarak dışa aktar" : "Export the complete filtered view as CSV"}>
        <Download size={14}/>{tr ? "CSV dışa aktar" : "Export CSV"}
      </a> : null}
      <EnterpriseCopyViewLink locale={locale} href={shareHref}/>
      <EnterpriseSavedViews locale={locale} moduleKey={moduleKey} current={current} savedViews={savedViews}/>
    </div>

    <span className="enterprise-view-count">{totalCount === shownCount
      ? (tr ? `${shownCount} kayıt` : `${shownCount} records`)
      : (tr ? `${shownCount} / ${totalCount} gösteriliyor` : `${shownCount} / ${totalCount} shown`)}</span>

    {activeViewChips.length ? <div className="enterprise-view-active-state" aria-label={tr ? "Etkin görünüm ayarları" : "Active view settings"}>
      <span>{tr ? "Etkin görünüm" : "Active view"}</span>
      <div>
        {activeViewChips.map((chip) => <Link key={chip.key} className="enterprise-view-chip" href={chip.href} title={chip.title}>
          <span>{chip.label}</span><X size={11} aria-hidden="true"/>
        </Link>)}
      </div>
    </div> : null}
  </div>;
}
