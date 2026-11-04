export type EnterpriseViewRouteSearch = Record<string, string | string[] | undefined>;

export type EnterpriseViewRouteState = {
  query: string;
  status?: string;
  columns: string[];
  columnsCustomized: boolean;
  density: "comfortable" | "compact";
  sortKey?: string;
  sortDirection: "asc" | "desc";
  page: number;
  pageSize: 25 | 50 | 100;
  savedViewId?: string;
};

function boundedSingle(value: string | string[] | undefined, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/u.test(normalized)) return undefined;
  return normalized;
}

export function parseEnterpriseViewRouteState(search: EnterpriseViewRouteSearch): EnterpriseViewRouteState {
  const query = typeof search.q === "string" ? search.q.trim().slice(0, 160) : "";
  const status = typeof search.status === "string" ? search.status.slice(0, 40) : undefined;
  const rawColumns = Array.isArray(search.columns) ? search.columns : typeof search.columns === "string" ? [search.columns] : [];
  const columns = rawColumns.slice(0, 12).map((value) => value.slice(0, 40));
  const sortKey = typeof search.sort === "string" ? search.sort.slice(0, 40) : undefined;
  const requestedPage = typeof search.page === "string" ? Number.parseInt(search.page, 10) : 1;
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10000) : 1;
  const requestedPageSize = typeof search.pageSize === "string" ? Number.parseInt(search.pageSize, 10) : 50;
  const pageSize = requestedPageSize === 25 || requestedPageSize === 100 ? requestedPageSize : 50;
  return {
    query,
    status,
    columns,
    columnsCustomized: search.columnsMode === "custom",
    density: search.density === "compact" ? "compact" : "comfortable",
    sortKey,
    sortDirection: search.dir === "desc" ? "desc" : "asc",
    page,
    pageSize,
    savedViewId: boundedSingle(search.view, 191)
  };
}
