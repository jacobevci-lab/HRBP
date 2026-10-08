import assert from "node:assert/strict";
import test from "node:test";
import { browserSecurityHeaders } from "../lib/browser-security-headers.mjs";

function mapHeaders() {
  return new Map(browserSecurityHeaders().map((entry) => [entry.key.toLowerCase(), entry.value]));
}

test("browser security headers are unique and fail closed on framing/content sniffing", () => {
  const headers = browserSecurityHeaders();
  assert.equal(new Set(headers.map((entry) => entry.key.toLowerCase())).size, headers.length);
  const values = mapHeaders();

  assert.equal(values.get("x-frame-options"), "DENY");
  assert.equal(values.get("x-content-type-options"), "nosniff");
  assert.equal(values.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(values.get("strict-transport-security"), "max-age=31536000");
});

test("CSP protects high-risk browser primitives without weakening script policy", () => {
  const csp = mapHeaders().get("content-security-policy");
  assert.ok(csp);
  for (const directive of [
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'"
  ]) assert.ok(csp.includes(directive), directive);

  assert.ok(!csp.includes("'unsafe-inline'"));
  assert.ok(!csp.includes("'unsafe-eval'"));
  assert.ok(!csp.includes("*"));
});

test("permissions policy disables unused high-risk browser capabilities", () => {
  const policy = mapHeaders().get("permissions-policy");
  assert.ok(policy);
  for (const feature of ["camera=()", "microphone=()", "geolocation=()", "payment=()", "usb=()"]) {
    assert.ok(policy.includes(feature), feature);
  }
});

test("callers receive a fresh mutable copy of immutable policy entries", () => {
  const first = browserSecurityHeaders();
  const second = browserSecurityHeaders();
  assert.notEqual(first, second);
  first[0].value = "changed";
  assert.notEqual(first[0].value, second[0].value);
});
