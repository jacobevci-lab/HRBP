/** Client projection of already authorized queue metadata. The API remains authoritative. */
type Decision = "APPROVED" | "REJECTED";
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 191 &&
  value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);

// Fail closed even if a malformed row carries a leave action under another kind.
export function isActionCenterLeaveItem(item: unknown): boolean {
  if (!object(item)) return false;
  return item.kind === "leave" ||
    (object(item.action) && item.action.type === "approve-leave") ||
    (object(item.secondaryAction) && item.secondaryAction.type === "reject-leave");
}

export function actionCenterLeaveControl(item: unknown): {
  requestId: string; allowedDecisions: Decision[];
} | null {
  if (!object(item) || item.kind !== "leave") return null;
  const allowedDecisions: Decision[] = [];
  let requestId: string | undefined;
  if (item.action != null) {
    if (!object(item.action) || item.action.type !== "approve-leave" || !identifier(item.action.requestId)) return null;
    requestId = item.action.requestId;
    allowedDecisions.push("APPROVED");
  }
  if (item.secondaryAction != null) {
    if (!object(item.secondaryAction) || item.secondaryAction.type !== "reject-leave" || !identifier(item.secondaryAction.requestId)) return null;
    if (requestId !== undefined && requestId !== item.secondaryAction.requestId) return null;
    requestId = item.secondaryAction.requestId;
    allowedDecisions.push("REJECTED");
  }
  return requestId ? { requestId, allowedDecisions } : null;
}
