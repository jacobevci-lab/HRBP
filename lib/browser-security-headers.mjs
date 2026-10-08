const CSP = [
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join("; ");

const headers = Object.freeze([
  Object.freeze({ key: "Content-Security-Policy", value: CSP }),
  Object.freeze({ key: "Strict-Transport-Security", value: "max-age=31536000" }),
  Object.freeze({ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }),
  Object.freeze({ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" }),
  Object.freeze({ key: "X-Content-Type-Options", value: "nosniff" }),
  Object.freeze({ key: "X-Frame-Options", value: "DENY" })
]);

export function browserSecurityHeaders() {
  return headers.map((entry) => ({ ...entry }));
}
