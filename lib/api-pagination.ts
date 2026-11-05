export type ApiPagination = {
  page: number;
  limit: number;
  skip: number;
};

function singlePositiveInteger(params: URLSearchParams, name: string, fallback: number, max: number) {
  const values = params.getAll(name);
  if (values.length === 0) return fallback;
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0])) return null;
  const value = Number(values[0]);
  if (!Number.isSafeInteger(value) || value > max) return null;
  return value;
}

export function parseApiPagination(request: Request, { defaultLimit = 200, maxLimit = 200, maxPage = 10000 } = {}): ApiPagination | null {
  if (!Number.isSafeInteger(defaultLimit) || defaultLimit < 1 || defaultLimit > maxLimit) throw new Error("Invalid default API pagination limit.");
  const params = new URL(request.url).searchParams;
  const page = singlePositiveInteger(params, "page", 1, maxPage);
  const limit = singlePositiveInteger(params, "limit", defaultLimit, maxLimit);
  if (page === null || limit === null) return null;
  return { page, limit, skip: (page - 1) * limit };
}

export function paginationMeta(page: number, limit: number, total: number) {
  const pageCount = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    pageCount,
    hasMore: page * limit < total
  };
}
