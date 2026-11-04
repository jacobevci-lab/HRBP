"use server";

import { revalidatePath } from "next/cache";
import {
  deleteSavedEnterpriseView,
  enterpriseViewBasePath,
  isEnterpriseViewModule,
  sanitizeEnterpriseViewState,
  upsertSavedEnterpriseView
} from "@/lib/enterprise-saved-views";
import { getServerRequestContext } from "@/lib/server-session";

export type SavedEnterpriseViewActionState = {
  ok: boolean;
  updated?: boolean;
  code?: "auth" | "invalid" | "limit" | "forbidden" | "unavailable";
};

function readModule(formData: FormData) {
  const value = formData.get("moduleKey");
  return typeof value === "string" && isEnterpriseViewModule(value) ? value : null;
}

function readViewState(formData: FormData, moduleKey: "people" | "positions") {
  return sanitizeEnterpriseViewState(moduleKey, {
    query: formData.get("query"),
    status: formData.get("status"),
    columns: formData.getAll("columns"),
    columnsCustomized: formData.get("columnsMode") === "custom",
    density: formData.get("density"),
    sortKey: formData.get("sort"),
    sortDirection: formData.get("dir"),
    pageSize: Number(formData.get("pageSize"))
  });
}

function codeFor(error: unknown): SavedEnterpriseViewActionState["code"] {
  const message = error instanceof Error ? error.message : "";
  if (message === "VIEW_NAME_INVALID") return "invalid";
  if (message === "VIEW_LIMIT") return "limit";
  if (message === "VIEW_FORBIDDEN") return "forbidden";
  return "unavailable";
}

export async function saveEnterpriseViewAction(
  _previous: SavedEnterpriseViewActionState,
  formData: FormData
): Promise<SavedEnterpriseViewActionState> {
  const moduleKey = readModule(formData);
  if (!moduleKey) return { ok: false, code: "invalid" };
  const ctx = await getServerRequestContext();
  if (!ctx) return { ok: false, code: "auth" };

  try {
    const result = await upsertSavedEnterpriseView(ctx, moduleKey, formData.get("name"), readViewState(formData, moduleKey));
    revalidatePath(enterpriseViewBasePath(moduleKey));
    return { ok: true, updated: result.updated };
  } catch (error) {
    return { ok: false, code: codeFor(error) };
  }
}

export async function deleteEnterpriseViewAction(formData: FormData): Promise<void> {
  const moduleKey = readModule(formData);
  const id = formData.get("id");
  if (!moduleKey || typeof id !== "string") return;
  const ctx = await getServerRequestContext();
  if (!ctx) return;

  try {
    await deleteSavedEnterpriseView(ctx, moduleKey, id);
    revalidatePath(enterpriseViewBasePath(moduleKey));
  } catch {
    // Fail closed. The current view remains usable if preference persistence is unavailable.
  }
}
