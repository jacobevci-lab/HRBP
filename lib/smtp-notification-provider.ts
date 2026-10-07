import nodemailer from "nodemailer";
import { DataClassification, type Prisma } from "@prisma/client";
import {
  notificationDisplayResourceHref,
  notificationDisplaySummary,
  notificationDisplayTitle
} from "@/lib/notification-display";
import { smtpConfigurationStatus } from "@/lib/notification-email-config";
import { runtimeBoolean, runtimeNumber, runtimeString } from "@/lib/runtime-env";

const MAX_SUBJECT = 200;
const MAX_TEXT = 32 * 1024;
const MAX_HTML = 64 * 1024;

export type EmailNotification = {
  outboxId: string;
  tenantId: string;
  eventType: string;
  recipient: string;
  resourceType: string;
  resourceId: string;
  classification: DataClassification;
  payload: Prisma.JsonValue | null;
};

function safeHeader(value: string, max = MAX_SUBJECT) {
  const normalized = value.replace(/[
]+/g, " ").replace(/s+/g, " ").trim();
  if (!normalized || normalized.length > max) throw new Error("SMTP_MESSAGE_INVALID");
  return normalized;
}

export function validEmailAddress(value: string) {
  const email = value.trim().toLowerCase();
  return email.length <= 254 &&
    !/[
]/.test(email) &&
    /^[^s@<>(),;:\"]+@[^s@<>(),;:\"]+.[^s@<>(),;:\"]+$/.test(email)
      ? email
      : null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character] ?? character));
}

function appOrigin() {
  const raw = runtimeString("APP_URL");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function messageIdDomain(from: string) {
  const configured = runtimeString("HRBP_SMTP_MESSAGE_ID_DOMAIN");
  if (configured && /^[A-Za-z0-9.-]{1,253}$/.test(configured)) return configured.toLowerCase();
  const match = /@([A-Za-z0-9.-]{1,253})>?$/.exec(from.trim());
  return match?.[1]?.toLowerCase() ?? "hrbp.invalid";
}

export function renderNotificationEmail(notification: EmailNotification, locale: "en" | "tr" = "en") {
  const restricted = notification.classification === DataClassification.RESTRICTED ||
    notification.classification === DataClassification.HIGHLY_RESTRICTED;
  const title = safeHeader(restricted
    ? (locale === "tr" ? "HRBP güvenli bildirimi" : "HRBP secure notification")
    : (notificationDisplayTitle(notification.eventType, locale) || "HRBP notification"));
  const href = restricted ? "/" : notificationDisplayResourceHref(notification.resourceType, notification.resourceId);
  const origin = appOrigin();
  const absoluteHref = origin && href.startsWith("/") ? new URL(href, origin).toString() : null;

  const summary = restricted
    ? (locale === "tr"
      ? "Kısıtlı bir HRBP kaydı aksiyonunuzu gerektiriyor. Ayrıntıları güvenli uygulama içinde görüntüleyin."
      : "A restricted HRBP record requires your attention. View the details inside the secured application.")
    : notificationDisplaySummary(notification.payload, locale);

  const boundedSummary = String(summary || (locale === "tr" ? "HRBP bildirimi" : "HRBP notification"))
    .replace(/s+/g, " ")
    .trim()
    .slice(0, 4000);
  const text = [title, "", boundedSummary, ...(absoluteHref ? ["", absoluteHref] : [])].join("
").slice(0, MAX_TEXT);
  const html = [
    "<!doctype html><html><body>",
    `<h2>${escapeHtml(title)}</h2>`,
    `<p>${escapeHtml(boundedSummary)}</p>`,
    ...(absoluteHref ? [`<p><a href="${escapeHtml(absoluteHref)}">${locale === "tr" ? "HRBP içinde görüntüle" : "View in HRBP"}</a></p>`] : []),
    "</body></html>"
  ].join("").slice(0, MAX_HTML);

  return { subject: title, text, html };
}

function smtpTransportOptions() {
  const status = smtpConfigurationStatus();
  if (!status.enabled || !status.configured) throw new Error("SMTP_CONFIGURATION_REQUIRED");

  const host = runtimeString("HRBP_SMTP_HOST")!;
  const port = Math.floor(runtimeNumber("HRBP_SMTP_PORT", 587));
  const secure = runtimeBoolean("HRBP_SMTP_SECURE", port === 465);
  const username = runtimeString("HRBP_SMTP_USERNAME")!;
  const password = runtimeString("HRBP_SMTP_PASSWORD")!;
  const servername = runtimeString("HRBP_SMTP_TLS_SERVERNAME") || host;

  return {
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user: username, pass: password },
    tls: { rejectUnauthorized: true, servername, minVersion: "TLSv1.2" as const },
    connectionTimeout: Math.min(20_000, Math.max(3_000, Math.floor(runtimeNumber("HRBP_SMTP_CONNECTION_TIMEOUT_MS", 8_000)))),
    greetingTimeout: Math.min(20_000, Math.max(3_000, Math.floor(runtimeNumber("HRBP_SMTP_GREETING_TIMEOUT_MS", 8_000)))),
    socketTimeout: Math.min(30_000, Math.max(5_000, Math.floor(runtimeNumber("HRBP_SMTP_SOCKET_TIMEOUT_MS", 15_000))))
  };
}

export async function sendSmtpNotification(
  notification: EmailNotification,
  options: { locale?: "en" | "tr"; createTransport?: typeof nodemailer.createTransport } = {}
) {
  const recipient = validEmailAddress(notification.recipient);
  if (!recipient) throw new Error("SMTP_RECIPIENT_INVALID");

  const from = runtimeString("HRBP_SMTP_FROM");
  if (!from || /[
]/.test(from) || from.length > 320) throw new Error("SMTP_FROM_INVALID");

  const rendered = renderNotificationEmail(notification, options.locale ?? "en");
  const stableMessageId = `<hrbp-${notification.outboxId}@${messageIdDomain(from)}>`;
  const transport = (options.createTransport ?? nodemailer.createTransport)(smtpTransportOptions());

  try {
    const result = await transport.sendMail({
      from,
      to: recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      messageId: stableMessageId,
      disableFileAccess: true,
      disableUrlAccess: true
    });

    const accepted = Array.isArray(result.accepted) ? result.accepted.map(String) : [];
    const rejected = Array.isArray(result.rejected) ? result.rejected.map(String) : [];
    if (accepted.length !== 1 || rejected.length !== 0) throw new Error("SMTP_RECIPIENT_REJECTED");

    return {
      accepted: 1,
      rejected: 0,
      messageId: typeof result.messageId === "string" ? result.messageId.slice(0, 320) : stableMessageId
    };
  } catch (error) {
    if (error instanceof Error && ["SMTP_RECIPIENT_REJECTED", "SMTP_RECIPIENT_INVALID", "SMTP_CONFIGURATION_REQUIRED", "SMTP_FROM_INVALID"].includes(error.message)) {
      throw error;
    }
    // Provider response text can include infrastructure details. Persist only a bounded machine code.
    throw new Error("SMTP_DELIVERY_FAILED");
  } finally {
    if (typeof transport.close === "function") transport.close();
  }
}
