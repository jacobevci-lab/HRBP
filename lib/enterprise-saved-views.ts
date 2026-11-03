import { can, type Capability } from "@/lib/authorization";
import { db, withDb } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";

export type EnterpriseViewModule = "people" | "positions";
export type EnterpriseViewState = {
  query: string;
  status?: string;
  columns: string[];
  columnsCustomized: boolean;
  density: "comfortable" | "compact";
};
export type SavedEnterpriseViewSummary = {
  id: string;
  name: string;
  moduleKey: EnterpriseViewModule;
  state: EnterpriseViewState;
  href: string;
};

const definitions: Record<EnterpriseViewModule, {
  capability: Capability;
  basePath: string;
  statuses: ReadonlySet<string>;
  columns: ReadonlySet<string>;
}> = {
  people: {
    capability: "people:read",
    basePath: "/module/people",
    statuses: new Set(["ACTIVE", "PREBOARDING", "LEAVE"]),
    columns: new Set(["position", "department", "location", "status", "start"])
  },
  positions: {
    capability: "positions:read",
    basePath: "/module/positions",
    statuses: new Set(["OPEN", "PLANNED", "FILLED", "FROZEN", "CLOSED"]),
    columns: new Set(["organization", "grade", "location", "incumbent", "status", "critical"])
  }
};

export function isEnterpriseViewModule(value: string): value is EnterpriseViewModule {
  return value === "people" || value === "positions";
}

export function enterpriseViewBasePath(moduleKey: EnterpriseViewModule) {
  return definitions[moduleKey].basePath;
}

export function normalizeSavedViewName(value: unknown): { name: string; normalizedName: string } | null {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 64) return null;
  return { name, normalizedName: name.normalize("NFKC").toLowerCase() };
}

export function sanitizeEnterpriseViewState(moduleKey: EnterpriseViewModule, input: {
  query?: unknown;
  status?: unknown;
  columns?: unknown;
  columnsCustomized?: unknown;
  density?: unknown;
}): EnterpriseViewState {
  const definition = definitions[moduleKey];
  const query = typeof input.query === "string" ? input.query.trim().slice(0, 160) : "";
  const statusCandidate = typeof input.status === "string" ? input.status.trim().toUpperCase().slice(0, 40) : "";
  const status = definition.statuses.has(statusCandidate) ? statusCandidate : undefined;
  const rawColumns = Array.isArray(input.columns) ? input.columns : [];
  const columns = [...new Set(rawColumns
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().slice(0, 40))
    .filter((value) => definition.columns.has(value)))]
    .slice(0, 12);
  return {
    query,
    status,
    columns,
    columnsCustomized: input.columnsCustomized === true,
    density: input.density === "compact" ? "compact" : "comfortable"
  };
}

export function buildEnterpriseViewHref(moduleKey: EnterpriseViewModule, state: EnterpriseViewState) {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.status) params.set("status", state.status);
  if (state.columnsCustomized) {
    params.set("columnsMode", "custom");
    for (const column of state.columns) params.append("columns", column);
  }
  if (state.density === "compact") params.set("density", "compact");
  const source = params.toString();
  return source ? `${definitions[moduleKey].basePath}?${source}` : definitions[moduleKey].basePath;
}

function assertViewAccess(ctx: RequestContext, moduleKey: EnterpriseViewModule) {
  if (!can(ctx, definitions[moduleKey].capability)) throw new Error("VIEW_FORBIDDEN");
}

function isPreferenceSchemaUnavailable(error: unknown) {
  const code = error && typeof error === "object" ? (error as { code?: string }).code : undefined;
  return code === "P2021" || code === "P2022";
}

export async function listSavedEnterpriseViews(ctx: RequestContext, moduleKey: EnterpriseViewModule): Promise<SavedEnterpriseViewSummary[]> {
  assertViewAccess(ctx, moduleKey);
  try {
    const rows = await db.savedEnterpriseView.findMany({
      where: { tenantId: ctx.tenantId, userId: ctx.actorId, moduleKey },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      take: 20,
      select: {
        id: true,
        name: true,
        moduleKey: true,
        query: true,
        status: true,
        columns: true,
        columnsCustomized: true,
        density: true
      }
    });
    return rows.map((row) => {
      const state = sanitizeEnterpriseViewState(moduleKey, {
        query: row.query,
        status: row.status,
        columns: row.columns,
        columnsCustomized: row.columnsCustomized,
        density: row.density
      });
      return { id: row.id, name: row.name, moduleKey, state, href: buildEnterpriseViewHref(moduleKey, state) };
    });
  } catch (error) {
    // Mixed-version deploy safety: absence of the preference table must not take
    // People/Positions offline. Writes remain unavailable until migrations land.
    if (isPreferenceSchemaUnavailable(error)) return [];
    throw error;
  }
}

export async function upsertSavedEnterpriseView(
  ctx: RequestContext,
  moduleKey: EnterpriseViewModule,
  rawName: unknown,
  input: EnterpriseViewState
) {
  assertViewAccess(ctx, moduleKey);
  const parsedName = normalizeSavedViewName(rawName);
  if (!parsedName) throw new Error("VIEW_NAME_INVALID");
  const state = sanitizeEnterpriseViewState(moduleKey, input);

  return withDb((client) => client.$transaction(async (tx) => {
    const key = {
      tenantId: ctx.tenantId,
      userId: ctx.actorId,
      moduleKey,
      normalizedName: parsedName.normalizedName
    };
    const existing = await tx.savedEnterpriseView.findUnique({
      where: { tenantId_userId_moduleKey_normalizedName: key },
      select: { id: true }
    });
    if (!existing) {
      const count = await tx.savedEnterpriseView.count({
        where: { tenantId: ctx.tenantId, userId: ctx.actorId, moduleKey }
      });
      if (count >= 20) throw new Error("VIEW_LIMIT");
    }
    return tx.savedEnterpriseView.upsert({
      where: { tenantId_userId_moduleKey_normalizedName: key },
      create: {
        ...key,
        name: parsedName.name,
        query: state.query,
        status: state.status ?? null,
        columns: state.columns,
        columnsCustomized: state.columnsCustomized,
        density: state.density
      },
      update: {
        name: parsedName.name,
        query: state.query,
        status: state.status ?? null,
        columns: state.columns,
        columnsCustomized: state.columnsCustomized,
        density: state.density
      },
      select: { id: true }
    });
  }));
}

export async function deleteSavedEnterpriseView(ctx: RequestContext, moduleKey: EnterpriseViewModule, id: string) {
  assertViewAccess(ctx, moduleKey);
  if (!id || id.length > 191 || /[\u0000-\u001f\u007f]/.test(id)) return 0;
  const result = await db.savedEnterpriseView.deleteMany({
    where: { id, tenantId: ctx.tenantId, userId: ctx.actorId, moduleKey }
  });
  return result.count;
}
