import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buildEnterprisePageHref, type EnterpriseViewModule, type EnterpriseViewState } from "@/lib/enterprise-saved-views";
import type { Locale } from "@/lib/i18n";

function pageWindow(page: number, pageCount: number) {
  const values = new Set<number>([1, pageCount, page - 2, page - 1, page, page + 1, page + 2]);
  return [...values].filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b);
}

export function EnterprisePagination({
  locale,
  moduleKey,
  state,
  page,
  pageCount,
  totalCount,
  shownCount
}: {
  locale: Locale;
  moduleKey: EnterpriseViewModule;
  state: EnterpriseViewState;
  page: number;
  pageCount: number;
  totalCount: number;
  shownCount: number;
}) {
  const tr = locale === "tr";
  const start = totalCount ? (page - 1) * state.pageSize + 1 : 0;
  const end = totalCount ? Math.min(start + shownCount - 1, totalCount) : 0;
  const pages = pageWindow(page, pageCount);

  return <nav className="enterprise-pagination" aria-label={tr ? "Tablo sayfaları" : "Table pages"}>
    <span className="enterprise-pagination-range">{tr ? `${start}–${end} / ${totalCount}` : `${start}–${end} of ${totalCount}`}</span>
    <div className="enterprise-pagination-pages">
      {page <= 1
        ? <span className="enterprise-page-button disabled" aria-disabled="true"><ChevronLeft size={14}/><span>{tr ? "Önceki" : "Previous"}</span></span>
        : <Link className="enterprise-page-button" href={buildEnterprisePageHref(moduleKey, state, page - 1)}><ChevronLeft size={14}/><span>{tr ? "Önceki" : "Previous"}</span></Link>}
      {pages.map((value, index) => {
        const previous = pages[index - 1];
        return <span className="enterprise-page-fragment" key={value}>
          {previous && value - previous > 1 ? <span className="enterprise-page-ellipsis">…</span> : null}
          {value === page ? <span className="enterprise-page-number active" aria-current="page">{value}</span> : <Link className="enterprise-page-number" href={buildEnterprisePageHref(moduleKey, state, value)}>{value}</Link>}
        </span>;
      })}
      {page >= pageCount
        ? <span className="enterprise-page-button disabled" aria-disabled="true"><span>{tr ? "Sonraki" : "Next"}</span><ChevronRight size={14}/></span>
        : <Link className="enterprise-page-button" href={buildEnterprisePageHref(moduleKey, state, page + 1)}><span>{tr ? "Sonraki" : "Next"}</span><ChevronRight size={14}/></Link>}
    </div>
  </nav>;
}
