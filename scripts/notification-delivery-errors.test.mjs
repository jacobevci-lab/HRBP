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
      if (Object.hasOwn(filter, "gte")) return value >= filter.gte;
      if (Object.hasOwn(filter, "gt")) return value > filter.gt;
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
        if (options.beforeUpdate) await options.beforeUpdate(query, rows);
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
    "@/lib/runtime-env": { runtimeNumber: (key, fallback) => options.runtime?.[key] ?? fallback },
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
  assert.equal(h.rows[0].status, "DEAD_LETTER"); assert.equal(result.deadLettered, 1);
});


// Stale recovery uses conditional writes, not a read-then-unconditional update.
// These deterministic interleavings model ownership changes; they are not real DB concurrency tests.
function stale(overrides = {}) {
  return candidate({ status: "PROCESSING", attempts: 5, lockedAt: new Date(epoch - 600_000), lastError: sentinel, ...overrides });
}
test("exhausted stale locks are dead-lettered without another delivery or attempt reset", async () => {
  for (const attempts of [5, 6, 20]) for (const channel of ["EMAIL", "IN_APP", "UNSUPPORTED"]) {
    const h = harness({ rows: [stale({ attempts, channel })] });
    const result = await h.run();
    assert.equal(h.rows[0].status, "DEAD_LETTER"); assert.equal(h.rows[0].attempts, attempts);
    assert.equal(h.rows[0].lockedAt, null); assert.equal(h.rows[0].lastError, "NOTIFICATION_LOCK_RECOVERED");
    assert.equal(Number(h.rows[0].nextAttemptAt), epoch); assert.equal(h.rows[0].deliveredAt, undefined);
    assert.equal(result.recovered, 1); assert.equal(result.deadLettered, 1);
    assert.equal(result.claimed, 0); assert.equal(result.candidates, 0); assert.equal(result.delivered, 0);
    assert.equal(h.sends.length, 0); assert.equal(h.userReads.length, 0);
    assert.ok(!JSON.stringify(h.updates).includes("PRIVATE_SENTINEL"));
  }
});
test("stale locks below the attempt limit retain the remaining delivery opportunity", async () => {
  for (const attempts of [0, 3, 4]) {
    const h = harness({ rows: [stale({ channel: "IN_APP", attempts })] });
    const result = await h.run();
    assert.equal(result.recovered, 1); assert.equal(result.claimed, 1); assert.equal(result.delivered, 1);
    assert.equal(result.deadLettered, 0); assert.equal(h.rows[0].attempts, attempts + 1);
    assert.equal(h.rows[0].status, "DELIVERED"); assert.equal(h.rows[0].lockedAt, null);
  }
});
test("recovered retryable SMTP failures retain backoff and the final-attempt limit", async () => {
  for (const attempts of [1, 3, 4]) {
    const h = harness({ rows: [stale({ attempts })], sendError: new Error("SMTP_DELIVERY_FAILED") });
    const result = await h.run(), exhausted = attempts === 4;
    assert.equal(h.rows[0].attempts, attempts + 1); assert.equal(h.sends.length, 1);
    assert.equal(h.rows[0].status, exhausted ? "DEAD_LETTER" : "FAILED");
    assert.equal(h.rows[0].lastError, "SMTP_DELIVERY_FAILED");
    assert.equal(Number(h.rows[0].nextAttemptAt), epoch + (exhausted ? 0 : 60_000 * 2 ** attempts));
    assert.equal(result.deadLettered, Number(exhausted)); assert.equal(result.failed, Number(!exhausted));
  }
});
test("recent, future and undated processing locks are not recovered even when exhausted", async () => {
  const rows = [epoch - 599_999, epoch, epoch + 60_000, null].map((lockedAt, i) => stale({
    id: `protected-${i}`, lockedAt: lockedAt === null ? null : new Date(lockedAt)
  }));
  const h = harness({ rows }), before = plain(h.rows), result = await h.run();
  assert.deepEqual(plain(h.rows), before); assert.equal(result.recovered, 0);
  assert.equal(result.deadLettered, 0); assert.equal(result.claimed, 0); assert.equal(h.sends.length, 0);
});
test("recovery never rewrites non-processing rows or historical exhausted failures", async () => {
  const rows = ["PENDING", "FAILED", "DEAD_LETTER", "DELIVERED"].map((status, i) => stale({ id: `state-${i}`, status }));
  const h = harness({ rows }), before = plain(h.rows), result = await h.run();
  assert.deepEqual(plain(h.rows), before); assert.equal(result.recovered, 0); assert.equal(result.deadLettered, 0);
});
test("mixed tenants and channels preserve recovery and terminal-transition counts", async () => {
  const h = harness({ rows: [stale({ id: "exhausted-a" }), stale({ id: "exhausted-b", tenantId: "other-tenant", channel: "IN_APP" }),
    stale({ id: "retryable", attempts: 1, channel: "IN_APP" }), candidate({ id: "unsupported", channel: "UNSUPPORTED" })] });
  const result = await h.run();
  assert.equal(result.recovered, 3); assert.equal(result.deadLettered, 3);
  assert.equal(result.claimed, 2); assert.equal(result.delivered, 1); assert.equal(result.failed, 0);
  assert.deepEqual(h.rows.map(r => r.status), ["DEAD_LETTER", "DEAD_LETTER", "DELIVERED", "DEAD_LETTER"]);
  assert.equal(h.rows[1].tenantId, "other-tenant"); assert.equal(h.sends.length, 0);
});
test("a repeated recovery pass cannot resend or recount already-terminal records", async () => {
  const h = harness({ rows: [stale()] }); await h.run();
  const before = plain(h.rows); h.setNow(epoch + 3_600_000);
  const result = await h.run();
  assert.equal(h.rows[0].status, "DEAD_LETTER"); assert.deepEqual(plain(h.rows), before);
  assert.equal(result.recovered, 0); assert.equal(result.deadLettered, 0); assert.equal(h.sends.length, 0);
});
test("recovery and selection share the same configured clamped attempt cap", async () => {
  for (const [configured, cap] of [[0, 2], [2.9, 2], [3, 3], [19, 19], [99, 20]]) {
    const h = harness({ runtime: { HRBP_NOTIFICATION_MAX_ATTEMPTS: configured }, rows: [
      stale({ id: "over", attempts: cap }), stale({ id: "under", attempts: cap - 1, channel: "IN_APP" })
    ] });
    const result = await h.run();
    assert.equal(h.rows[0].status, "DEAD_LETTER"); assert.equal(h.rows[0].attempts, cap);
    assert.equal(h.rows[1].status, "DELIVERED"); assert.equal(h.rows[1].attempts, cap);
    assert.equal(result.deadLettered, 1); assert.equal(result.recovered, 2);
    for (const query of h.reads) assert.equal(query.where.attempts.lt, cap);
  }
});
test("configured lock-window boundary is inclusive and retains the existing clamps", async () => {
  for (const [configured, minutes] of [[0, 2], [3.9, 3], [999, 120]]) {
    const cutoff = epoch - minutes * 60_000;
    const h = harness({ runtime: { HRBP_NOTIFICATION_LOCK_MINUTES: configured }, rows: [
      stale({ id: "at-boundary", lockedAt: new Date(cutoff) }),
      stale({ id: "one-ms-recent", lockedAt: new Date(cutoff + 1) })
    ] });
    const before = plain(h.rows[1]); const result = await h.run();
    assert.equal(h.rows[0].status, "DEAD_LETTER"); assert.deepEqual(plain(h.rows[1]), before);
    assert.equal(result.recovered, 1); assert.equal(result.deadLettered, 1);
  }
});
test("an owner refreshing the lock before the terminal write is not overwritten", async () => {
  let raced = false;
  const h = harness({ rows: [stale()], beforeUpdate(query, rows) {
    if (!raced && !query.where.id && query.data.status === "DEAD_LETTER") {
      raced = true; rows[0].lockedAt = new Date(epoch);
    }
  } });
  const result = await h.run();
  assert.equal(raced, true); assert.equal(h.rows[0].status, "PROCESSING");
  assert.equal(Number(h.rows[0].lockedAt), epoch); assert.equal(h.rows[0].lastError, sentinel);
  assert.equal(result.recovered, 0); assert.equal(result.deadLettered, 0); assert.equal(h.sends.length, 0);
});
test("an owner completing before recovery is not changed back into a failure", async () => {
  let raced = false;
  const h = harness({ rows: [stale()], beforeUpdate(query, rows) {
    if (!raced && !query.where.id && query.data.status === "DEAD_LETTER") {
      raced = true; Object.assign(rows[0], { status: "DELIVERED", deliveredAt: new Date(epoch), lockedAt: null, lastError: null });
    }
  } });
  const result = await h.run();
  assert.equal(raced, true); assert.equal(h.rows[0].status, "DELIVERED");
  assert.equal(Number(h.rows[0].deliveredAt), epoch); assert.equal(h.rows[0].lastError, null);
  assert.equal(result.recovered, 0); assert.equal(result.deadLettered, 0);
});
test("a recovery write error aborts selection and delivery instead of claiming success", async () => {
  const failure = new Error("synthetic recovery write failure");
  const h = harness({ rows: [stale()], beforeUpdate(query) {
    if (!query.where.id && query.data.status === "DEAD_LETTER") throw failure;
  } });
  await assert.rejects(h.run(), error => error === failure);
  assert.equal(h.reads.length, 0); assert.equal(h.sends.length, 0); assert.equal(h.rows[0].status, "PROCESSING");
});
test("both recovery writes bind status, expiry and disjoint attempt ranges without resetting attempts", async () => {
  const h = harness({ rows: [] }); await h.run();
  assert.equal(h.updates.length, 2);
  const terminal = h.updates.find(q => q.data.status === "DEAD_LETTER");
  const retry = h.updates.find(q => q.data.status === "FAILED");
  for (const query of [terminal, retry]) {
    assert.ok(query); assert.equal(query.where.status, "PROCESSING");
    assert.equal(Number(query.where.lockedAt.lte), epoch - 600_000);
    assert.equal(query.data.lockedAt, null); assert.equal(query.data.lastError, "NOTIFICATION_LOCK_RECOVERED");
    for (const field of ["attempts", "tenantId", "recipientUserId", "deliveredAt", "payload"]) assert.equal(query.data[field], undefined);
  }
  assert.deepEqual(plain(terminal.where.attempts), { gte: 5 });
  assert.deepEqual(plain(retry.where.attempts), { lt: 5 });
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

const inputValidation = load("lib/input-validation.ts", {}, { TextDecoder });
function retryHarness(options = {}) {
  const context = Object.hasOwn(options, "context") ? options.context : { tenantId: "tenant-test", actorId: "admin-test" };
  const rows = (options.rows ?? [
    candidate({ id: "dead-1", status: "DEAD_LETTER" }),
    candidate({ id: "dead-2", status: "DEAD_LETTER" }),
    candidate({ id: "failed-1", status: "FAILED" })
  ]).map((row) => ({ ...row }));
  const reads = [], writes = [], audits = [];
  const db = {
    notificationOutbox: {
      async findMany(query) {
        reads.push(query);
        return rows.filter((row) => matches(row, query.where)).slice(0, query.take ?? rows.length).map((row) => ({ id: row.id }));
      }
    },
    async $transaction(run) {
      return run({
        notificationOutbox: {
          async updateMany(query) {
            writes.push(query);
            let count = 0;
            for (const row of rows) {
              if (!matches(row, query.where)) continue;
              count++;
              Object.assign(row, query.data);
            }
            return { count };
          }
        }
      });
    }
  };
  const route = load("app/api/settings/notifications/retry/route.ts", {
    "@/lib/input-validation": inputValidation,
    "@prisma/client": { ...enums, DataClassification: { INTERNAL: "INTERNAL" } },
    "@/lib/audit": { appendAudit: async (_tx, _ctx, event) => { audits.push(event); } },
    "@/lib/authorization": {
      can: (_ctx, permission) => { assert.equal(permission, "settings:write"); return options.allowed !== false; },
      forbidden: () => new Response(null, { status: 403 })
    },
    "@/lib/db": { db },
    "@/lib/request-context": {
      getRequestContext: async () => context,
      mutationOriginAllowed: () => options.originAllowed !== false,
      unauthorized: () => new Response(null, { status: 401 })
    }
  }, { Request, Response, URL, TextDecoder });
  async function post(body, raw) {
    return route.POST(new Request("https://hrbp.example.test/api/settings/notifications/retry", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://hrbp.example.test" },
      body: raw === undefined ? JSON.stringify(body) : raw
    }));
  }
  return { rows, reads, writes, audits, post };
}
test("invalid targeted retry ids fail closed instead of widening to a batch", async () => {
  for (const id of ["", "   ", null, 7, [], {}, "bad\u0000id"]) {
    const h = retryHarness();
    const before = plain(h.rows);
    const response = await h.post({ id });
    assert.equal(response.status, 400);
    assert.equal(h.reads.length, 0);
    assert.equal(h.writes.length, 0);
    assert.equal(h.audits.length, 0);
    assert.deepEqual(plain(h.rows), before);
  }
});
test("missing, ambiguous, malformed and misspelled retry scope never becomes bulk retry", async () => {
  for (const payload of [{}, { id: "dead-1", batch: true }, { batch: false }, { notificationId: "dead-1" }, { idd: "dead-1" }, { batch: true, typo: 1 }]) {
    const h = retryHarness();
    const response = await h.post(payload);
    assert.equal(response.status, 400);
    assert.equal(h.reads.length, 0);
    assert.equal(h.writes.length, 0);
    assert.equal(h.audits.length, 0);
  }
  for (const raw of ["{", "[]", "null", "\"dead-1\""]) {
    const h = retryHarness();
    assert.equal((await h.post(undefined, raw)).status, 400);
    assert.equal(h.reads.length, 0);
  }
});
test("targeted retry stays one-id, tenant-scoped and cannot carry batch options", async () => {
  const h = retryHarness();
  assert.equal((await h.post({ id: " dead-1 " })).status, 200);
  assert.equal(h.rows.find((row) => row.id === "dead-1").status, "PENDING");
  assert.equal(h.rows.find((row) => row.id === "dead-2").status, "DEAD_LETTER");
  assert.equal(h.rows.find((row) => row.id === "failed-1").status, "FAILED");
  assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0].where.tenantId, "tenant-test");
  assert.equal(h.reads[0].where.id, "dead-1");
  assert.deepEqual(plain(h.reads[0].where.status.in), ["DEAD_LETTER", "FAILED"]);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(plain(h.writes[0].where.id.in), ["dead-1"]);
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].action, "settings.notification-requeued");
  assert.equal(h.audits[0].resourceId, "dead-1");

  const ambiguous = retryHarness();
  assert.equal((await ambiguous.post({ id: "dead-1", limit: 1 })).status, 400);
  assert.equal(ambiguous.reads.length, 0);
});
test("explicit batch=true is the only bulk path and remains dead-letter-only and bounded", async () => {
  const h = retryHarness();
  const response = await h.post({ batch: true, limit: 1 });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { requeued: 1 } });
  assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0].where.tenantId, "tenant-test");
  assert.equal(h.reads[0].where.status, "DEAD_LETTER");
  assert.equal(h.reads[0].take, 1);
  assert.equal(h.rows.filter((row) => row.status === "PENDING").length, 1);
  assert.equal(h.rows.find((row) => row.id === "failed-1").status, "FAILED");
  assert.equal(h.audits[0].action, "settings.notifications-dead-letter-requeued");
  assert.equal(h.audits[0].resourceId, "dead-letter-batch");
});
test("batch limits are strict integers and cannot be coerced or silently clamped", async () => {
  for (const limit of [0, -1, 1.5, 501, "1", null, true, {}, []]) {
    const h = retryHarness();
    assert.equal((await h.post({ batch: true, limit })).status, 400);
    assert.equal(h.reads.length, 0);
    assert.equal(h.writes.length, 0);
  }
  for (const limit of [1, 500]) {
    const h = retryHarness();
    assert.equal((await h.post({ batch: true, limit })).status, 200);
    assert.equal(h.reads[0].take, limit);
  }
});
test("missing targeted rows return 404 without mutation while authorization failures touch no storage", async () => {
  const missing = retryHarness();
  const missingResponse = await missing.post({ id: "does-not-exist" });
  assert.equal(missingResponse.status, 404);
  assert.equal(missing.reads.length, 1);
  assert.equal(missing.writes.length, 0);
  assert.equal(missing.audits.length, 0);

  const unauthenticated = retryHarness({ context: null });
  assert.equal((await unauthenticated.post({ id: "dead-1" })).status, 401);
  assert.equal(unauthenticated.reads.length, 0);

  const forbidden = retryHarness({ allowed: false });
  assert.equal((await forbidden.post({ id: "dead-1" })).status, 403);
  assert.equal(forbidden.reads.length, 0);

  const badOrigin = retryHarness({ originAllowed: false });
  assert.equal((await badOrigin.post({ id: "dead-1" })).status, 403);
  assert.equal(badOrigin.reads.length, 0);
});

test("production prebuild still invokes existing validation plus this executable suite", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(pkg.scripts.prebuild.split(" && ").includes("npm run notification-operations:validate"));
  assert.equal(pkg.scripts["notification-operations:validate"], "node scripts/validate-notification-operations.mjs && node --test scripts/notification-delivery-errors.test.mjs");
});
