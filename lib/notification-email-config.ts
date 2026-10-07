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
  const events = notificationEmailEvents();
  if (!enabled) return { enabled, configured: false, missing, events };

  const host = runtimeString("HRBP_SMTP_HOST");
  const username = runtimeString("HRBP_SMTP_USERNAME");
  const password = runtimeString("HRBP_SMTP_PASSWORD");
  const from = runtimeString("HRBP_SMTP_FROM");
  const portRaw = runtimeString("HRBP_SMTP_PORT") ?? "587";
  const port = Number(portRaw);

  if (!host || !/^[A-Za-z0-9.-]{1,253}$/.test(host) || host.includes("..")) missing.push("HRBP_SMTP_HOST");
  if (!username) missing.push("HRBP_SMTP_USERNAME");
  if (!password || password.length < 16) missing.push("HRBP_SMTP_PASSWORD");
  if (!from || from.length > 320 || /[\r\n]/.test(from) ||
      !/[A-Za-z0-9.!#$%&'*+/=?^_\`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(from)) {
    missing.push("HRBP_SMTP_FROM");
  }
  if (!/^\d+$/.test(portRaw) || !Number.isInteger(port) || port < 1 || port > 65535) missing.push("HRBP_SMTP_PORT");
  if (!events.length) missing.push("HRBP_NOTIFICATION_EMAIL_EVENTS");

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
