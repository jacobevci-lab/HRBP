import { DataClassification } from "@prisma/client";
import { runtimeBoolean, runtimeNumber, runtimeString } from "@/lib/runtime-env";

const EVENT_PATTERN = /^[A-Z][A-Z0-9_]{2,127}$/;

export function notificationEmailEvents() {
  return [...new Set(
    (runtimeString("HRBP_NOTIFICATION_EMAIL_EVENTS") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => EVENT_PATTERN.test(value))
      .slice(0, 200)
  )];
}

export function smtpConfigurationStatus() {
  const enabled = runtimeBoolean("HRBP_SMTP_ENABLED", false);
  const missing: string[] = [];
  if (!enabled) return { enabled, configured: false, missing, events: notificationEmailEvents() };

  for (const name of ["HRBP_SMTP_HOST", "HRBP_SMTP_USERNAME", "HRBP_SMTP_PASSWORD", "HRBP_SMTP_FROM"] as const) {
    if (!runtimeString(name)) missing.push(name);
  }
  const port = Math.floor(runtimeNumber("HRBP_SMTP_PORT", 587));
  if (!Number.isInteger(port) || port < 1 || port > 65535) missing.push("HRBP_SMTP_PORT");

  const events = notificationEmailEvents();
  if (!events.length) missing.push("HRBP_NOTIFICATION_EMAIL_EVENTS");

  const from = runtimeString("HRBP_SMTP_FROM");
  if (from && (from.length > 320 || /[
]/.test(from))) missing.push("HRBP_SMTP_FROM");

  return { enabled, configured: missing.length === 0, missing: [...new Set(missing)], events };
}

export function notificationEmailPolicyAllows(eventType: string, classification: DataClassification) {
  if (!runtimeBoolean("HRBP_SMTP_ENABLED", false)) return false;
  if (!notificationEmailEvents().includes(eventType)) return false;
  if (classification === DataClassification.HIGHLY_RESTRICTED) return false;
  if (classification === DataClassification.RESTRICTED &&
      !runtimeBoolean("HRBP_NOTIFICATION_EMAIL_ALLOW_RESTRICTED", false)) return false;
  return true;
}

export function shouldMirrorNotificationToEmail(input: {
  eventType: string;
  classification: DataClassification;
  explicitChannel?: string | null;
}) {
  return !input.explicitChannel && notificationEmailPolicyAllows(input.eventType, input.classification);
}

export function notificationEmailBatchSize() {
  return Math.min(50, Math.max(1, Math.floor(runtimeNumber("HRBP_NOTIFICATION_EMAIL_BATCH_SIZE", 10))));
}
