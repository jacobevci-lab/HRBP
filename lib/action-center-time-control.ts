/** Client projection of already authorized Action Center time metadata. API policy remains authoritative. */
type Decision = "APPROVED" | "REJECTED";
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 191 &&
  value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);

export function isActionCenterTimeItem(item: unknown): boolean {
  if (!object(item)) return false;
  return item.kind === "time-attendance" ||
    (object(item.action) && item.action.type === "approve-time") ||
    (object(item.secondaryAction) && item.secondaryAction.type === "reject-time");
}

export function actionCenterTimeControl(item: unknown): {
  entryId: string; allowedDecisions: Decision[];
} | null {
  if (!object(item) || item.kind !== "time-attendance") return null;
  const allowedDecisions: Decision[] = [];
  let entryId: string | undefined;
  if (item.action != null) {
    if (!object(item.action) || item.action.type !== "approve-time" || !identifier(item.action.entryId)) return null;
    entryId = item.action.entryId;
    allowedDecisions.push("APPROVED");
  }
  if (item.secondaryAction != null) {
    if (!object(item.secondaryAction) || item.secondaryAction.type !== "reject-time" || !identifier(item.secondaryAction.entryId)) return null;
    if (entryId !== undefined && entryId !== item.secondaryAction.entryId) return null;
    entryId = item.secondaryAction.entryId;
    allowedDecisions.push("REJECTED");
  }
  return entryId ? { entryId, allowedDecisions } : null;
}
