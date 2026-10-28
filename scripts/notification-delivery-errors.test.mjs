import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Execute the application sources with explicit in-memory boundaries. These are
// control-flow/unit tests, NOT PostgreSQL, SMTP transport, or deployed-Worker tests.
function load(path, dependencies = {}, globals = {}) {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true
  });
  assert.equal((compiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  runInNewContext(compiled.outputText, {
    module, exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected application dependency: ${name}`);
      return dependencies[name];
    },
    ...globals
  }, { filename: path, timeout: 2000 });
  return module.exports;
}
const policy = load("lib/notification-delivery-error.ts");
const code = policy.notificationDeliveryErrorCode;
const FALLBACK = "NOTIFICATION_DELIVERY_FAILED";
const plain = (value) => JSON.parse(JSON.stringify(value));
const codes = [
  "IN_APP_RECIPIENT_REQUIRED", "IN_APP_ROLE_UNSUPPORTED", "IN_APP_ROLE_RECIPIENTS_UNAVAILABLE",
  "EMAIL_RECIPIENT_REQUIRED", "EMAIL_ROLE_UNSUPPORTED", "EMAIL_ROLE_RECIPIENTS_UNAVAILABLE",
  "EMAIL_NOTIFICATION_POLICY_BLOCKED", "EMAIL_RECIPIENT_UNAVAILABLE", "NOTIFICATION_CHANNEL_UNSUPPORTED",
  "SMTP_MESSAGE_INVALID", "SMTP_CONFIGURATION_REQUIRED", "SMTP_RECIPIENT_INVALID", "SMTP_FROM_INVALID",
  "SMTP_RECIPIENT_REJECTED", "SMTP_DELIVERY_FAILED", "NOTIFICATION_LOCK_RECOVERED", FALLBACK
];
const sentinel = "PRIVATE_SENTINEL smtp://account:password@mail.internal payroll@example.test SELECT salary FROM private_rows";

test("exact reviewed codes survive Error objects and stored strings", () => {
  for (const value of codes) {
    assert.equal(code(new Error(value)), value);
    assert.equal(code(value), value);
    assert.match(code(value), /^[A-Z_]{1,64}$/);
  }
});
test("raw provider/database/stack/credential text never becomes a diagnostic", () => {
  for (const value of [sentinel, new Error(sentinel), new Error("SMTP_DELIVERY_FAILED\n" + sentinel), new Error("SQL: " + sentinel)]) {
    assert.equal(code(value), FALLBACK);
  }
});
test("no prefix matching, trimming, case folding, or control-character normalization", () => {
  for (const suffix of [":details", " ", "\n", "\r", "\0", "\u200b", sentinel]) {
    assert.equal(code("SMTP_RECIPIENT_INVALID" + suffix), FALLBACK);
  }
  for (const value of [" SMTP_RECIPIENT_INVALID", "smtp_recipient_invalid", "SMTP_SECRET_UNREVIEWED", "SmtpDeliveryError"]) {
    assert.equal(code(value), FALLBACK);
  }
});
test("nullish values, primitives and arbitrary structures fail closed", () => {
  for (const value of [null, undefined, 123, true, 1n, Symbol("private"), [], {}, { message: 7 }, { code: sentinel }, new String("SMTP_DELIVERY_FAILED")]) {
    assert.equal(code(value), FALLBACK);
  }
});
test("message getters and coercion/cause hooks are not invoked", () => {
  let touched = 0;
  const value = { get message() { touched++; throw new Error(sentinel); }, toString() { touched++; return sentinel; }, get cause() { touched++; throw new Error(sentinel); } };
  assert.equal(code(value), FALLBACK);
  const inherited = Object.create({ get message() { touched++; return "SMTP_RECIPIENT_INVALID"; } });
  assert.equal(code(inherited), FALLBACK);
  assert.equal(touched, 0);
});
test("revoked proxies and throwing descriptor traps fail closed", () => {
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  assert.equal(code(proxy), FALLBACK);
  assert.equal(code(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(sentinel); } })), FALLBACK);
});
test("cross-realm errors and null-prototype data messages are bounded", () => {
  assert.equal(code(runInNewContext('new Error("SMTP_CONFIGURATION_REQUIRED")')), "SMTP_CONFIGURATION_REQUIRED");
  assert.equal(code(Object.assign(Object.create(null), { message: "SMTP_DELIVERY_FAILED" })), "SMTP_DELIVERY_FAILED");
});
test("long inputs are not truncated into allowlisted codes", () => {
  assert.equal(code("SMTP_DELIVERY_FAILED" + "x".repeat(100_000)), FALLBACK);
  assert.equal(code({ message: "x".repeat(100_000) }), FALLBACK);
});
test("only the exact historical fixed lock message is migrated on read", () => {
  assert.equal(code("Recovered stale notification dispatcher lock"), "NOTIFICATION_LOCK_RECOVERED");
  assert.equal(code("Recovered stale notification dispatcher lock " + sentinel), FALLBACK);
});

const statuses = Object.fromEntries(["PENDING", "PROCESSING", "FAILED", "DEAD_LETTER", "DELIVERED"].map((s) => [s, s]));
const enums = { NotificationOutboxStatus: statuses, PlatformRole: { HR_ADMIN: "HR_ADMIN" } };
const epoch = Date.parse("2026-10-28T12:00:00Z");
function candidate(overrides = {}) {
  return {
    id: "outbox-test", tenantId: "tenant-test", eventType: "test.event", channel: "EMAIL",
    recipientUserId: "user-test", recipientRole: null, templateKey: null,
    resourceType: "test", resourceId: "resource-test", dedupeKey: "dedupe-test", payload: null,
    classification: "INTERNAL", status: "PENDING", attempts: 0,
    nextAttemptAt: new Date(epoch - 1000), lockedAt: null, lastError: null,
    createdAt: new Date(epoch - 2000), updatedAt: new Date(epoch - 2000), ...overrides
  };
}
function matches(row, where) {
  return Object.entries(where).every(([key, filter]) => {
    const value = row[key];
    if (filter && typeof filter === "object" && !(filter instanceof Date)) {
      if (Object.hasOwn(filter, "in")) return filter.in.includes(value);
      if (Object.hasOwn(filter, "notIn")) return !filter.notIn.includes(value);
      if (Object.hasOwn(filter, "lte")) return value !== null && Number(value) <= Number(filter.lte);
      if (Object.hasOwn(filter, "lt")) return value < filter.lt;
      throw new Error("Unimplemented mock predicate: " + key);
    }
    return value === filter;
  });
}
function harness(options = {}) {
  let now = epoch;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const rows = (options.rows ?? [candidate(options.candidate)]).map((row) => ({ ...row }));
  const updates = [], reads = [], sends = [], userReads = [];
  const db = {
    notificationOutbox: {
      async findMany(query) {
        reads.push(query);
        return rows.filter((row) => matches(row, query.where)).slice(0, query.take).map((row) => ({ ...row }));
      },
      async updateMany(query) {
        updates.push(query);
        if (options.loseClaim && query.data.status === "PROCESSING") return { count: 0 };
        if (options.loseCompletion && query.where.id && query.where.status === "PROCESSING") return { count: 0 };
        let count = 0;
        for (const row of rows) {
          if (!matches(row, query.where)) continue;
          count++;
          for (const [key, value] of Object.entries(query.data)) {
            row[key] = value && typeof value === "object" && Object.hasOwn(value, "increment") ? row[key] + value.increment : value;
          }
        }
        return { count };
      }
    },
    userAccount: {
      async findFirst(query) {
        userReads.push(query);
        if (Object.hasOwn(options, "lookupError")) throw options.lookupError;
        return options.noRecipient ? null : { email: "recipient@example.test" };
      },
      async findMany() {
        if (Object.hasOwn(options, "lookupError")) throw options.lookupError;
        return [];
      }
    }
  };
  const dispatcher = load("lib/notification-dispatcher.ts", {
    "@prisma/client": enums,
    "@/lib/db": { db },
    "@/lib/notification-email-config": {
      notificationEmailBatchSize: () => 10,
      notificationEmailPolicyAllows: () => options.policyAllowed !== false
    },
    "@/lib/smtp-notification-provider": { async sendSmtpNotification(message) {
      sends.push(message);
      if (Object.hasOwn(options, "sendError")) throw options.sendError;
    } },
    "@/lib/runtime-env": { runtimeNumber: (_key, fallback) => fallback },
    "@/lib/notification-delivery-error": policy
  }, { Date: Clock });
  return { rows, updates, reads, sends, userReads, run: dispatcher.runNotificationDispatcher, setNow: (value) => { now = value; } };
}
function assertFailed(h, expected = FALLBACK, status = "FAILED") {
  const row = h.rows[0];
  assert.equal(row.lastError, expected);
  assert.equal(row.status, status);
  assert.equal(row.lockedAt, null);
  assert.equal(row.attempts, 1);
  assert.ok(!JSON.stringify(h.updates).includes("PRIVATE_SENTINEL"));
  for (const write of h.updates.filter((q) => q.where.id)) {
    assert.equal(write.where.tenantId, "tenant-test");
    assert.equal(write.where.id, "outbox-test");
    assert.equal(typeof write.where.attempts, "number");
  }
}
test("unexpected SMTP errors persist only the fallback and retain retry delay", async () => {
  const h = harness({ sendError: new Error(sentinel) });
  const result = await h.run();
  assertFailed(h);
  assert.equal(Number(h.rows[0].nextAttemptAt), epoch + 60_000);
  assert.equal(result.failed, 1); assert.equal(result.deadLettered, 0); assert.equal(result.delivered, 0);
});
test("recipient database errors cannot persist raw queries or credentials", async () => {
  const h = harness({ lookupError: new Error(sentinel) });
  await h.run(); assertFailed(h); assert.equal(h.sends.length, 0);
  assert.deepEqual(plain(h.userReads[0].where), { id: "user-test", tenantId: "tenant-test", active: true });
});
test("unknown thrown values and throwing message accessors do not strand the claim", async () => {
  for (const value of [null, Symbol("secret"), { get message() { throw new Error(sentinel); } }, { toString() { throw new Error(sentinel); } }]) {
    const h = harness({ sendError: value });
    await h.run(); assertFailed(h);
  }
});
test("policy denial stays non-retryable without looking up recipients or sending", async () => {
  const h = harness({ policyAllowed: false });
  const result = await h.run();
  assertFailed(h, "EMAIL_NOTIFICATION_POLICY_BLOCKED", "DEAD_LETTER");
  assert.equal(result.deadLettered, 1); assert.equal(result.failed, 0);
  assert.equal(h.userReads.length, 0); assert.equal(h.sends.length, 0);
});
test("invalid SMTP recipients retain non-retryable classification", async () => {
  const h = harness({ sendError: new Error("SMTP_RECIPIENT_INVALID") });
  await h.run(); assertFailed(h, "SMTP_RECIPIENT_INVALID", "DEAD_LETTER");
});
test("unsupported channels remain dead-lettered without provider calls", async () => {
  const h = harness({ candidate: { channel: "UNSUPPORTED" } });
  await h.run(); assertFailed(h, "NOTIFICATION_CHANNEL_UNSUPPORTED", "DEAD_LETTER");
  assert.equal(h.sends.length, 0);
});
test("code-like raw errors do not inherit permanent-failure classification", async () => {
  const h = harness({ sendError: new Error("SMTP_RECIPIENT_INVALID: " + sentinel) });
  const result = await h.run(); assertFailed(h); assert.equal(result.deadLettered, 0);
});
test("known transient codes remain available for operator diagnosis", async () => {
  for (const message of ["SMTP_CONFIGURATION_REQUIRED", "SMTP_FROM_INVALID", "SMTP_RECIPIENT_REJECTED", "SMTP_DELIVERY_FAILED"]) {
    const h = harness({ sendError: new Error(message) }); await h.run(); assertFailed(h, message);
  }
});
test("missing recipient and IN_APP role failures keep their exact codes", async () => {
  const email = harness({ noRecipient: true }); await email.run(); assertFailed(email, "EMAIL_RECIPIENT_UNAVAILABLE");
  const inApp = harness({ candidate: { channel: "IN_APP", recipientUserId: null } });
  await inApp.run(); assertFailed(inApp, "IN_APP_RECIPIENT_REQUIRED");
});
test("retry clock and attempt cap are preserved, with no premature replay", async () => {
  const h = harness({ sendError: new Error(sentinel) });
  for (let attempt = 1; attempt <= 5; attempt++) {
    const before = h.rows[0].attempts;
    const currentTime = attempt === 1 ? epoch : Number(h.rows[0].nextAttemptAt);
    await h.run();
    assert.equal(h.rows[0].attempts, before + 1);
    assert.equal(h.rows[0].lastError, FALLBACK);
    if (attempt < 5) {
      const next = Number(h.rows[0].nextAttemptAt), snapshot = plain(h.rows[0]);
      assert.equal(next - currentTime, Math.min(3600, 60 * 2 ** (attempt - 1)) * 1000);
      assert.equal((await h.run()).claimed, 0); assert.deepEqual(plain(h.rows[0]), snapshot);
      h.setNow(next);
    }
  }
  assert.equal(h.rows[0].status, "DEAD_LETTER");
  assert.equal((await h.run()).claimed, 0); assert.equal(h.sends.length, 5);
});
test("successful EMAIL and direct IN_APP delivery still clear old diagnostics", async () => {
  for (const channel of ["EMAIL", "IN_APP"]) {
    const h = harness({ candidate: { channel, lastError: sentinel } });
    const result = await h.run();
    assert.equal(result.delivered, 1); assert.equal(h.rows[0].status, "DELIVERED");
    assert.equal(h.rows[0].lastError, null); assert.equal(h.rows[0].lockedAt, null);
    assert.equal(h.sends.length, channel === "EMAIL" ? 1 : 0);
  }
});
test("lost claims cannot invoke SMTP or overwrite diagnostic state", async () => {
  const h = harness({ loseClaim: true, sendError: new Error(sentinel) });
  const before = plain(h.rows); const result = await h.run();
  assert.equal(result.claimed, 0); assert.equal(h.sends.length, 0); assert.deepEqual(plain(h.rows), before);
});
test("lost completion ownership cannot count a failed or delivered write", async () => {
  const h = harness({ loseCompletion: true, sendError: new Error(sentinel) });
  const result = await h.run();
  assert.equal(result.claimed, 1); assert.equal(result.failed, 0); assert.equal(result.deadLettered, 0);
  assert.equal(result.delivered, 0); assert.equal(h.rows[0].status, "PROCESSING");
  assert.equal(h.rows[0].lastError, null);
});
test("stale-lock diagnostics are fixed codes and future records are unchanged", async () => {
  const h = harness({ rows: [candidate({ status: "PROCESSING", lockedAt: new Date(epoch - 20 * 60_000), attempts: 5 }), candidate({ id: "future", nextAttemptAt: new Date(epoch + 60_000) })] });
  const future = plain(h.rows[1]); const result = await h.run();
  assert.equal(result.recovered, 1); assert.equal(h.rows[0].lastError, "NOTIFICATION_LOCK_RECOVERED");
  assert.equal(h.rows[0].lockedAt, null); assert.deepEqual(plain(h.rows[1]), future);
});

function operationsHarness({ context = { tenantId: "tenant-test" }, allowed = true, errors = [] } = {}) {
  const queries = [], rows = errors.map((lastError, i) => ({ id: `item-${i}`, status: "FAILED", lastError }));
  const route = load("app/api/settings/notifications/operations/route.ts", {
    "@prisma/client": enums,
    "@/lib/authorization": { can: (_ctx, permission) => { assert.equal(permission, "settings:read"); return allowed; }, forbidden: () => new Response(null, { status: 403 }) },
    "@/lib/request-context": { getRequestContext: async () => context, unauthorized: () => new Response(null, { status: 401 }) },
    "@/lib/db": { db: { notificationOutbox: {
      async groupBy(query) { queries.push(query); return [{ status: "FAILED", _count: { _all: rows.length } }]; },
      async findMany(query) { queries.push(query); return rows; }
    } } },
    "@/lib/notification-delivery-error": policy
  }, { Response, URL });
  return { rows, queries, get: (query = "") => route.GET(new Request("https://hrbp.example.test/api/settings/notifications/operations" + query)) };
}
test("operations API masks historical raw diagnostics without rewriting stored rows", async () => {
  const h = operationsHarness({ errors: [sentinel, "SMTP_DELIVERY_FAILED", null, "Recovered stale notification dispatcher lock", ""] });
  const before = plain(h.rows); const response = await h.get(); const json = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(json.data.items.map((item) => item.lastError), [FALLBACK, "SMTP_DELIVERY_FAILED", null, "NOTIFICATION_LOCK_RECOVERED", FALLBACK]);
  assert.ok(!JSON.stringify(json).includes("PRIVATE_SENTINEL")); assert.deepEqual(plain(h.rows), before);
  assert.equal(json.data.counts.failed, 5); assert.equal(json.data.counts.pending, 0);
});
test("operations API retains tenant scope, read authority and minimal projections", async () => {
  const h = operationsHarness(); await h.get();
  for (const query of h.queries) assert.equal(query.where.tenantId, "tenant-test");
  const query = h.queries.find((q) => q.select);
  assert.deepEqual(plain(query.where.status.in), ["PENDING", "PROCESSING", "FAILED", "DEAD_LETTER"]);
  assert.equal(query.select.lastError, true);
  for (const field of ["payload", "recipientUserId", "dedupeKey"]) assert.equal(query.select[field], undefined);
});
test("unauthenticated operations requests cannot access notification storage", async () => {
  const h = operationsHarness({ context: null }); assert.equal((await h.get()).status, 401); assert.equal(h.queries.length, 0);
});
test("unauthorized operations requests cannot access notification storage", async () => {
  const h = operationsHarness({ allowed: false }); assert.equal((await h.get()).status, 403); assert.equal(h.queries.length, 0);
});
test("operations query limits remain bounded", async () => {
  for (const [query, limit] of [["", 100], ["?limit=999999", 200], ["?limit=-1", 1], ["?limit=not-a-number", 100]]) {
    const h = operationsHarness(); await h.get(query); assert.equal(h.queries.find((q) => q.select).take, limit);
  }
});
test("production prebuild still invokes existing validation plus this executable suite", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(pkg.scripts.prebuild.split(" && ").includes("npm run notification-operations:validate"));
  assert.equal(pkg.scripts["notification-operations:validate"], "node scripts/validate-notification-operations.mjs && node --test scripts/notification-delivery-errors.test.mjs");
});
