import nodemailer from "nodemailer";
import { DataClassification, type Prisma } from "@prisma/client";
import { notificationDisplayResourceHref, notificationDisplaySummary, notificationDisplayTitle } from "@/lib/notification-display";
import { runtimeBoolean, runtimeNumber, runtimeString } from "@/lib/runtime-env";

const MAX_SUBJECT = 200;
const MAX_TEXT = 32 * 1024;
const MAX_HTML = 64 * 1024;

export type EmailNotification = {
  tenantId: string;
  eventType: string;
  recipient: string;
  resourceType: string;
  resourceId: string;
  classification: DataClassification;
  payload: Prisma.JsonValue | null;
};

export function smtpConfigurationStatus() {
  const required = ["HRBP_SMTP_HOST", "HRBP_SMTP_USERNAME", "HRBP_SMTP_PASSWORD", "HRBP_SMTP_FROM"] as const;
  const missing = required.filter((name) => !runtimeString(name));
  const port = Math.floor(runtimeNumber("HRBP_SMTP_PORT", 587));
  if (!Number.isInteger(port) || port < 1 || port > 65535) missing.push("HRBP_SMTP_PORT" as never);
  return { configured: missing.length === 0, missing: [...new Set(missing)] };
}

function safeHeader(value: string, max = MAX_SUBJECT) {
  const normalized = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > max) throw new Error("SMTP_MESSAGE_INVALID");
  return normalized;
}

export function validEmailAddress(value: string) {
  const email = value.trim().toLowerCase();
  return email.length <= 254 &&
    !/[\r\n]/.test(email) &&
    /^[^\s@<>(),;:\\"]+@[^\s@<>(),;:\\"]+\.[^\s@<>(),;:\\"]+$/.test(email)
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

export function renderNotificationEmail(notification: EmailNotification, locale: "en" | "tr" = "en") {
  const title = safeHeader(notificationDisplayTitle(notification.eventType, locale) || "HRBP notification");
  const href = notificationDisplayResourceHref(notification.resourceType, notification.resourceId);
  const origin = appOrigin();
  const absoluteHref = origin && href.startsWith("/") ? new URL(href, origin).toString() : null;

  const restricted = notification.classification === DataClassification.RESTRICTED ||
    notification.classification === DataClassification.HIGHLY_RESTRICTED;
  const summary = restricted
    ? (locale === "tr"
      ? "Kısıtlı bir HRBP kaydı aksiyonunuzu gerektiriyor. Ayrıntıları güvenli uygulama içinde görüntüleyin."
      : "A restricted HRBP record requires your attention. View the details inside the secured application.")
    : notificationDisplaySummary(notification.payload, locale);

  const boundedSummary = String(summary || (locale === "tr" ? "HRBP bildirimi" : "HRBP notification"))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
  const text = [title, "", boundedSummary, ...(absoluteHref ? ["", absoluteHref] : [])].join("\n").slice(0, MAX_TEXT);
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
  if (!status.configured) throw new Error("SMTP_CONFIGURATION_REQUIRED");

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
    tls: { rejectUnauthorized: true, servername },
    connectionTimeout: Math.min(30_000, Math.max(3_000, Math.floor(runtimeNumber("HRBP_SMTP_CONNECTION_TIMEOUT_MS", 10_000)))),
    greetingTimeout: Math.min(30_000, Math.max(3_000, Math.floor(runtimeNumber("HRBP_SMTP_GREETING_TIMEOUT_MS", 10_000)))),
    socketTimeout: Math.min(90_000, Math.max(5_000, Math.floor(runtimeNumber("HRBP_SMTP_SOCKET_TIMEOUT_MS", 30_000))))
  };
}

export async function sendSmtpNotification(
  notification: EmailNotification,
  options: { locale?: "en" | "tr"; createTransport?: typeof nodemailer.createTransport } = {}
) {
  const recipient = validEmailAddress(notification.recipient);
  if (!recipient) throw new Error("SMTP_RECIPIENT_INVALID");

  const from = runtimeString("HRBP_SMTP_FROM");
  if (!from || /[\r\n]/.test(from) || from.length > 320) throw new Error("SMTP_FROM_INVALID");

  const rendered = renderNotificationEmail(notification, options.locale ?? "en");
  const transport = (options.createTransport ?? nodemailer.createTransport)(smtpTransportOptions());
  try {
    const result = await transport.sendMail({
      from,
      to: recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      disableFileAccess: true,
      disableUrlAccess: true
    });
    return {
      accepted: Array.isArray(result.accepted) ? result.accepted.length : 0,
      rejected: Array.isArray(result.rejected) ? result.rejected.length : 0,
      messageId: typeof result.messageId === "string" ? result.messageId.slice(0, 320) : null
    };
  } catch {
    // Do not surface SMTP host/user/provider response text into durable notification errors.
    throw new Error("SMTP_DELIVERY_FAILED");
  } finally {
    if (typeof transport.close === "function") transport.close();
  }
}
