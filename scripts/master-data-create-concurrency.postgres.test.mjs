import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";

const enabled = process.env.HRBP_DISPOSABLE_MASTER_DATA_CONCURRENCY === "true";
const database = new URL(process.env.DATABASE_URL || "about:blank");

function assertDisposableDatabase() {
  assert.ok(["postgres:", "postgresql:"].includes(database.protocol));
  assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.equal(database.pathname, "/hrbp");
  assert.equal(database.search, "");
}

function barrier(parties = 2) {
  let arrived = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  return async () => {
    arrived += 1;
    if (arrived === parties) release();
    await gate;
  };
}

function serializable(db, work) {
  return db.$transaction(work, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 20_000,
    timeout: 30_000
  });
}

function assertOneSerialized(outcomes) {
  const fulfilled = outcomes.filter(item => item.status === "fulfilled");
  const rejected = outcomes.filter(item => item.status === "rejected");
  assert.equal(fulfilled.length, 1, "Exactly one concurrent writer may commit");
  assert.equal(rejected.length, 1, "Exactly one concurrent writer must fail closed");
  assert.equal(rejected[0].reason?.code, "P2034", "The losing Serializable writer must surface Prisma P2034");
}

test("Serializable employee duplicate pre-check prevents concurrent duplicate work-email commits", { skip: !enabled }, async () => {
  assertDisposableDatabase();
  const db = new PrismaClient();
  const suffix = randomUUID();
  const tenantId = `ci-md-person-${suffix}`;
  const email = `concurrent-${suffix}@example.test`;
  const rendezvous = barrier();

  try {
    await db.tenant.create({ data: { id: tenantId, name: "CI master-data concurrency", region: "test" } });

    const writer = employeeNumber => serializable(db, async tx => {
      const duplicate = await tx.person.findFirst({
        where: {
          tenantId,
          OR: [
            { employeeNumber },
            { workEmail: { equals: email, mode: "insensitive" } }
          ]
        },
        select: { id: true }
      });
      assert.equal(duplicate, null);
      await rendezvous();
      return tx.person.create({
        data: {
          tenantId,
          employeeNumber,
          givenName: "Concurrent",
          familyName: "Person",
          workEmail: email,
          classification: "CONFIDENTIAL"
        }
      });
    });

    const outcomes = await Promise.allSettled([writer("CI-A"), writer("CI-B")]);
    assertOneSerialized(outcomes);
    assert.equal(await db.person.count({ where: { tenantId, workEmail: email } }), 1);
  } finally {
    await db.person.deleteMany({ where: { tenantId } }).catch(() => undefined);
    await db.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("Serializable current-position pre-check prevents concurrent duplicate current position codes", { skip: !enabled }, async () => {
  assertDisposableDatabase();
  const db = new PrismaClient();
  const suffix = randomUUID();
  const tenantId = `ci-md-position-${suffix}`;
  const code = `CI-${suffix.slice(0, 8).toUpperCase()}`;
  const rendezvous = barrier();

  try {
    await db.tenant.create({ data: { id: tenantId, name: "CI position concurrency", region: "test" } });
    const org = await db.organizationUnit.create({
      data: {
        tenantId,
        code: `ORG-${suffix.slice(0, 8).toUpperCase()}`,
        name: "CI Security",
        type: "DEPARTMENT",
        validFrom: new Date("2026-01-01T00:00:00.000Z")
      }
    });

    const writer = offset => serializable(db, async tx => {
      const duplicate = await tx.position.findFirst({
        where: { tenantId, positionCode: code, validTo: null },
        select: { id: true }
      });
      assert.equal(duplicate, null);
      await rendezvous();
      return tx.position.create({
        data: {
          tenantId,
          orgUnitId: org.id,
          positionCode: code,
          title: "Concurrent Security Engineer",
          status: "OPEN",
          critical: false,
          validFrom: new Date(1767225600000 + offset)
        }
      });
    });

    const outcomes = await Promise.allSettled([writer(1000), writer(2000)]);
    assertOneSerialized(outcomes);
    assert.equal(await db.position.count({ where: { tenantId, positionCode: code, validTo: null } }), 1);
  } finally {
    await db.position.deleteMany({ where: { tenantId } }).catch(() => undefined);
    await db.organizationUnit.deleteMany({ where: { tenantId } }).catch(() => undefined);
    await db.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("conditional OPEN seat claim permits only one concurrent claimant", { skip: !enabled }, async () => {
  assertDisposableDatabase();
  const db = new PrismaClient();
  const suffix = randomUUID();
  const tenantId = `ci-md-seat-${suffix}`;

  try {
    await db.tenant.create({ data: { id: tenantId, name: "CI seat claim", region: "test" } });
    const org = await db.organizationUnit.create({
      data: {
        tenantId,
        code: `SEAT-${suffix.slice(0, 8).toUpperCase()}`,
        name: "CI Seat Org",
        type: "DEPARTMENT",
        validFrom: new Date("2026-01-01T00:00:00.000Z")
      }
    });
    const position = await db.position.create({
      data: {
        tenantId,
        orgUnitId: org.id,
        positionCode: `SEAT-${suffix.slice(9, 17).toUpperCase()}`,
        title: "CI Atomic Seat",
        status: "OPEN",
        critical: false,
        validFrom: new Date("2026-01-01T00:00:00.000Z")
      }
    });

    const claim = () => serializable(db, tx => tx.position.updateMany({
      where: { id: position.id, tenantId, status: "OPEN", validTo: null },
      data: { status: "FILLED" }
    }));

    const outcomes = await Promise.allSettled([claim(), claim()]);
    const committedCounts = outcomes
      .filter(item => item.status === "fulfilled")
      .map(item => item.value.count);
    const claimed = committedCounts.reduce((sum, count) => sum + count, 0);
    assert.equal(claimed, 1, "Exactly one transaction may change OPEN to FILLED");
    assert.equal((await db.position.findUniqueOrThrow({ where: { id: position.id } })).status, "FILLED");
  } finally {
    await db.position.deleteMany({ where: { tenantId } }).catch(() => undefined);
    await db.organizationUnit.deleteMany({ where: { tenantId } }).catch(() => undefined);
    await db.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
    await db.$disconnect();
  }
});
