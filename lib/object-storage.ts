import { createHash, createHmac } from "node:crypto";
import { runtimeString } from "@/lib/runtime-env";

type StorageConfig = {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
};

function getStorageConfig(): StorageConfig | null {
  const endpoint = runtimeString("OBJECT_STORAGE_ENDPOINT")?.replace(/\/$/, "");
  const accessKey = runtimeString("OBJECT_STORAGE_ACCESS_KEY");
  const secretKey = runtimeString("OBJECT_STORAGE_SECRET_KEY");
  const bucket = runtimeString("OBJECT_STORAGE_BUCKET");
  if (!endpoint || !accessKey || !secretKey || !bucket) return null;
  return {
    endpoint,
    accessKey,
    secretKey,
    bucket,
    region: runtimeString("OBJECT_STORAGE_REGION") || "us-east-1"
  };
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalObjectPath(basePath: string, bucket: string, objectKey: string) {
  const prefix = basePath === "/" ? "" : basePath.replace(/\/$/, "");
  const encodedKey = objectKey.split("/").map(awsEncode).join("/");
  return `${prefix}/${awsEncode(bucket)}/${encodedKey}`.replace(/\/+/g, "/");
}

function amzTimestamp(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signedRequest(config: StorageConfig, method: "GET" | "PUT", objectKey: string, payloadHash: string) {
  const endpoint = new URL(config.endpoint);
  const canonicalUri = canonicalObjectPath(endpoint.pathname, config.bucket, objectKey);
  const target = new URL(endpoint.toString());
  target.pathname = canonicalUri;
  target.search = "";

  const now = new Date();
  const amzDate = amzTimestamp(now);
  const dateStamp = amzDate.slice(0, 8);
  const canonicalHeaders = `host:${target.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");

  const dateKey = hmac(`AWS4${config.secretKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const headers = new Headers({ authorization, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate });
  return { target, headers };
}

export function objectStorageConfigured() {
  return Boolean(getStorageConfig());
}

export async function fetchPrivateObject(objectKey: string, range?: string | null) {
  const config = getStorageConfig();
  if (!config) return { configured: false as const, response: null };
  const request = signedRequest(config, "GET", objectKey, sha256(""));
  if (range?.trim()) request.headers.set("range", range.trim());
  const response = await fetch(request.target, { method: "GET", headers: request.headers, redirect: "manual" });
  return { configured: true as const, response };
}

export async function putPrivateObject(objectKey: string, body: ArrayBuffer, contentType: string) {
  const config = getStorageConfig();
  const bytes = new Uint8Array(body);
  const contentHash = sha256(bytes);
  if (!config) return { configured: false as const, response: null, contentHash };
  const request = signedRequest(config, "PUT", objectKey, contentHash);
  request.headers.set("content-type", contentType);
  request.headers.set("content-length", String(body.byteLength));
  const response = await fetch(request.target, { method: "PUT", headers: request.headers, body, redirect: "manual" });
  return { configured: true as const, response, contentHash };
}

export function downloadResponseHeaders(source: Headers, fileName: string) {
  const headers = new Headers();
  const safeName = fileName.replace(/[\r\n"]/g, "_");
  headers.set("content-disposition", `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  headers.set("content-type", source.get("content-type") || "application/octet-stream");
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "sandbox");
  for (const name of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}
