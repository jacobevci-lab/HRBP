/** Pure S3 CLI decoding shared by collection and OFFLINE provenance verification. */
import { validateS3RetentionRequirements } from "./audit-pilot-s3-retention.mjs";

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, fields) => object(value) && Object.keys(value).length === fields.length &&
  fields.every(field => Object.hasOwn(value, field));
export class S3ReadbackError extends Error {
  constructor(code) { super("S3 readback decoding failed."); this.code = code; }
}
function requireCondition(condition, code = "COLLECTION_INPUT_INVALID") {
  if (!condition) throw new S3ReadbackError(code);
}
const MAX_JSON_BYTES = 64 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_TOKENS = 8192;
/** Inspect the original token stream before JSON.parse can discard duplicate names.
 * This is a bounded lexical guard, NOT a replacement JSON grammar or canonicalizer.
 * Native JSON.parse still validates grammar and constructs values. Decoded names
 * are compared per object, including objects in arrays and escaped spellings.
 */
function guardJsonTokens(text) {
  const token = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null|[{}\[\]:,]/y;
  const whitespace = /[ \t\r\n]*/y;
  const containers = [];
  let offset = 0, count = 0;
  while (offset < text.length) {
    whitespace.lastIndex = offset;
    whitespace.exec(text);
    offset = whitespace.lastIndex;
    if (offset === text.length) break;
    token.lastIndex = offset;
    const match = token.exec(text);
    requireCondition(match !== null && ++count <= MAX_JSON_TOKENS, "COLLECTION_JSON_INVALID");
    const lexeme = match[0];
    offset = token.lastIndex;
    if (lexeme === "{" || lexeme === "[") {
      requireCondition(containers.length < MAX_JSON_DEPTH, "COLLECTION_JSON_INVALID");
      containers.push({ kind: lexeme, names: new Set() });
    } else if (lexeme === "}" || lexeme === "]") {
      requireCondition(containers.at(-1)?.kind === (lexeme === "}" ? "{" : "["), "COLLECTION_JSON_INVALID");
      containers.pop();
    } else if (lexeme.startsWith('"')) {
      const decoded = JSON.parse(lexeme);
      requireCondition(decoded.isWellFormed(), "COLLECTION_JSON_INVALID");
      whitespace.lastIndex = offset;
      whitespace.exec(text);
      if (text[whitespace.lastIndex] === ":") {
        const parent = containers.at(-1);
        requireCondition(parent?.kind === "{" && !parent.names.has(decoded), "COLLECTION_JSON_INVALID");
        parent.names.add(decoded);
      }
    } else if (/^[-0-9]/.test(lexeme)) {
      requireCondition(Number.isFinite(Number(lexeme)), "COLLECTION_JSON_INVALID");
    }
  }
  requireCondition(containers.length === 0, "COLLECTION_JSON_INVALID");
}
export function parseS3CollectionJson(bytes, compact = false) {
  try {
    requireCondition(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= MAX_JSON_BYTES &&
      typeof compact === "boolean", "COLLECTION_JSON_INVALID");
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    guardJsonTokens(text);
    const value = JSON.parse(text);
    requireCondition(object(value) && (!compact || text === JSON.stringify(value) + "\n"), "COLLECTION_JSON_INVALID");
    requireCondition(!Object.hasOwn(value, "Error") && !Object.hasOwn(value, "Errors"), "AWS_RESPONSE_INVALID");
    return value;
  } catch (error) {
    if (error instanceof S3ReadbackError) throw error;
    // Native syntax/UTF-8 errors may contain input snippets; never expose them.
    throw new S3ReadbackError("COLLECTION_JSON_INVALID");
  }
}
function timestamp(value) {
  // CLI v2 ISO8601 UTC output only. Do not infer missing dates or silently roll invalid calendar days.
  requireCondition(typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|\+00:00)$/.test(value), "AWS_RESPONSE_INVALID");
  const ms = Date.parse(value);
  requireCondition(Number.isFinite(ms), "AWS_RESPONSE_INVALID");
  const normalized = new Date(ms).toISOString();
  requireCondition(normalized.slice(0, 19) === value.slice(0, 19), "AWS_RESPONSE_INVALID");
  return normalized;
}
/** Explicit projection, not invented successful defaults. All raw CLI stdout is retained separately. */
export function normalizeS3Readback(operation, response) {
  requireCondition(object(response), "AWS_RESPONSE_INVALID");
  if (operation === "bucketVersioning") return { Status: response.Status };
  if (operation === "objectLockConfiguration") {
    requireCondition(object(response.ObjectLockConfiguration), "AWS_RESPONSE_INVALID");
    return { ObjectLockEnabled: response.ObjectLockConfiguration.ObjectLockEnabled };
  }
  if (operation === "objectRetention") {
    requireCondition(exact(response.Retention, ["Mode", "RetainUntilDate"]), "AWS_RESPONSE_INVALID");
    return { Mode: response.Retention.Mode, RetainUntilDate: timestamp(response.Retention.RetainUntilDate) };
  }
  if (operation === "legalHold") {
    requireCondition(exact(response.LegalHold, ["Status"]), "AWS_RESPONSE_INVALID");
    return { Status: response.LegalHold.Status };
  }
  requireCondition(operation === "headObject" &&
    !Object.keys(response).some(key => key.startsWith("ObjectLockEventHold")), "AWS_RESPONSE_INVALID");
  return {
    VersionId: response.VersionId, ContentLength: response.ContentLength,
    ChecksumSHA256: response.ChecksumSHA256, ChecksumType: response.ChecksumType,
    // S3 returns this header for a delete marker; successful ordinary HEAD may omit it.
    DeleteMarker: Object.hasOwn(response, "DeleteMarker") ? response.DeleteMarker : false,
    ObjectLockMode: response.ObjectLockMode,
    ObjectLockRetainUntilDate: timestamp(response.ObjectLockRetainUntilDate),
    ObjectLockLegalHoldStatus: response.ObjectLockLegalHoldStatus
  };
}
export function parseS3CollectionRequest(bytes) {
  const request = parseS3CollectionJson(bytes, true);
  requireCondition(exact(request, ["schemaVersion", "scope", "region", "requirements"]) &&
    request.schemaVersion === 1 && request.scope === "HRBP_S3_READ_COLLECTION:1" &&
    typeof request.region === "string" &&
    /^(af|ap|ca|eu|il|me|mx|sa|us)-(central|east|west|north|south|northeast|southeast)-[1-9][0-9]?$/.test(request.region));
  validateS3RetentionRequirements(request.requirements);
  // The narrow standard-bucket collector does not support access-point/MRAP aliases or directory buckets.
  requireCondition(!["-s3alias", "--ol-s3", ".mrap", "--x-s3", "--table-s3"].some(suffix => request.requirements.bucket.endsWith(suffix)));
  return request;
}
