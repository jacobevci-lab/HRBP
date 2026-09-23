import { runtimeNumber } from "@/lib/runtime-env";

const allowedTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip"
]);

export function documentUploadMaxBytes() {
  const configured = Math.floor(runtimeNumber("DOCUMENT_UPLOAD_MAX_BYTES", 25 * 1024 * 1024));
  return Math.min(Math.max(configured, 1024), 100 * 1024 * 1024);
}

export function normalizeDocumentContentType(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase();
  return normalized && allowedTypes.has(normalized) ? normalized : null;
}

export function normalizeSha256(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

export function allowedDocumentContentTypes() {
  return [...allowedTypes];
}
