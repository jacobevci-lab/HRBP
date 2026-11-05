"use server";

import { revalidatePath } from "next/cache";
import { bulkSetPositionCriticality } from "@/lib/position-bulk-actions";
import { getServerRequestContext } from "@/lib/server-session";

export type PositionBulkActionState = {
  ok: boolean;
  code?: "auth" | "invalid" | "forbidden" | "scope" | "conflict" | "unavailable";
  selected?: number;
  changed?: number;
  critical?: boolean;
};

function errorCode(error: unknown): PositionBulkActionState["code"] {
  const message = error instanceof Error ? error.message : "";
  if (message === "POSITION_BULK_INVALID") return "invalid";
  if (message === "POSITION_BULK_FORBIDDEN") return "forbidden";
  if (message === "POSITION_BULK_SCOPE_MISMATCH") return "scope";
  if (message === "POSITION_BULK_CONFLICT") return "conflict";
  return "unavailable";
}

export async function positionBulkCriticalityAction(
  _previous: PositionBulkActionState,
  formData: FormData
): Promise<PositionBulkActionState> {
  const operation = formData.get("operation");
  if (operation !== "mark-critical" && operation !== "clear-critical") {
    return { ok: false, code: "invalid" };
  }

  const ctx = await getServerRequestContext();
  if (!ctx) return { ok: false, code: "auth" };

  try {
    const result = await bulkSetPositionCriticality(
      ctx,
      formData.getAll("positionIds"),
      operation === "mark-critical"
    );
    revalidatePath("/module/positions");
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, code: errorCode(error) };
  }
}
