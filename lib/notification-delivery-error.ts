// Persist and expose only reviewed diagnostics, never provider/database messages.
// This is output minimization, not authentication of an error's origin.
const deliveryErrorCodes = [
  "IN_APP_RECIPIENT_REQUIRED",
  "IN_APP_ROLE_UNSUPPORTED",
  "IN_APP_ROLE_RECIPIENTS_UNAVAILABLE",
  "EMAIL_RECIPIENT_REQUIRED",
  "EMAIL_ROLE_UNSUPPORTED",
  "EMAIL_ROLE_RECIPIENTS_UNAVAILABLE",
  "EMAIL_NOTIFICATION_POLICY_BLOCKED",
  "EMAIL_RECIPIENT_UNAVAILABLE",
  "NOTIFICATION_CHANNEL_UNSUPPORTED",
  "SMTP_MESSAGE_INVALID",
  "SMTP_CONFIGURATION_REQUIRED",
  "SMTP_RECIPIENT_INVALID",
  "SMTP_FROM_INVALID",
  "SMTP_RECIPIENT_REJECTED",
  "SMTP_DELIVERY_FAILED",
  "NOTIFICATION_LOCK_RECOVERED",
  "NOTIFICATION_DELIVERY_FAILED"
] as const;

export type NotificationDeliveryErrorCode = typeof deliveryErrorCodes[number];
const allowedCodes: ReadonlySet<string> = new Set(deliveryErrorCodes);
const fallback: NotificationDeliveryErrorCode = "NOTIFICATION_DELIVERY_FAILED";

export function notificationDeliveryErrorCode(error: unknown): NotificationDeliveryErrorCode {
  let message: unknown = error;
  if (typeof error !== "string") {
    if (error === null || (typeof error !== "object" && typeof error !== "function")) return fallback;
    try {
      // Do not invoke message getters, String(error), toString, or inspect causes.
      const descriptor = Object.getOwnPropertyDescriptor(error, "message");
      message = descriptor && "value" in descriptor ? descriptor.value : undefined;
    } catch {
      return fallback;
    }
  }
  if (typeof message !== "string" || message.length > 64) return fallback;
  // Read compatibility for the previous fixed stale-lock diagnostic; no raw text leaves here.
  if (message === "Recovered stale notification dispatcher lock") return "NOTIFICATION_LOCK_RECOVERED";
  return allowedCodes.has(message) ? message as NotificationDeliveryErrorCode : fallback;
}
