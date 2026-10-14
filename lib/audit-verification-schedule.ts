import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

const VERSION = 1;
const LEASE_MS = 120_000;
const TRANSACTION = { maxWait: 2_000, timeout: 5_000 };
type Position = { id: string; createdAt: Date };
type State = {
  scheduleVersion: number;
  cursorTenantId: string | null;
  cursorCreatedAt: Date | null;
  upperTenantId: string | null;
  upperCreatedAt: Date | null;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  databaseNow: Date;
};
type Lease = {
  token: string;
  cursor: Position | null;
  upper: Position | null;
  tenants: Position[];
  nextIndex: number;
  endOfCycle: boolean;
  finished: boolean;
};

function failure(code: string): Error & { code: string } {
  return Object.assign(new Error("Audit verification schedule could not safely advance."), { code });
}
function same(a: Position | null, b: Position | null) {
  return a === null || b === null ? a === b : a.id === b.id && a.createdAt.getTime() === b.createdAt.getTime();
}
function position(id: string | null, createdAt: Date | null): Position | null {
  if (id === null && createdAt === null) return null;
  if (!id || !(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) {
    throw failure("AUDIT_SCHEDULE_STATE_INVALID");
  }
  return { id, createdAt };
}

/** Internal operational state, not a tenant API or independent audit trust anchor.
 * The key override is for isolated integration fixtures; production uses the
 * single deployment key. Every process must use the same database and key.
 */
export function createAuditVerificationScheduler(database: PrismaClient, key = "audit-integrity") {
  async function lock(tx: Prisma.TransactionClient): Promise<State> {
    const rows = await tx.$queryRaw<State[]>`
      SELECT "scheduleVersion", "cursorTenantId", "cursorCreatedAt", "upperTenantId", "upperCreatedAt",
             "leaseToken", "leaseExpiresAt", clock_timestamp() AT TIME ZONE 'UTC' AS "databaseNow"
      FROM "AuditVerificationSchedule" WHERE "id" = ${key} FOR UPDATE
    `;
    const state = rows[0];
    if (!state || state.scheduleVersion !== VERSION) throw failure("AUDIT_SCHEDULE_VERSION_UNSUPPORTED");
    const cursor = position(state.cursorTenantId, state.cursorCreatedAt);
    const upper = position(state.upperTenantId, state.upperCreatedAt);
    if ((cursor && !upper) || ((state.leaseToken === null) !== (state.leaseExpiresAt === null)) ||
        !(state.databaseNow instanceof Date) || !Number.isFinite(state.databaseNow.getTime())) {
      throw failure("AUDIT_SCHEDULE_STATE_INVALID");
    }
    return state;
  }
  function owned(state: State, lease: Lease) {
    if (lease.finished || state.leaseToken !== lease.token || !state.leaseExpiresAt ||
        state.leaseExpiresAt <= state.databaseNow ||
        !same(position(state.cursorTenantId, state.cursorCreatedAt), lease.cursor) ||
        !same(position(state.upperTenantId, state.upperCreatedAt), lease.upper)) {
      throw failure("AUDIT_SCHEDULE_LEASE_LOST");
    }
  }
  async function fence(tx: Prisma.TransactionClient, lease: Lease) {
    // Recheck the database clock AFTER receipt/outbox work. Expiry rolls back
    // that work too. The row lock stays held through transaction commit.
    const changed = await tx.$executeRaw`
      UPDATE "AuditVerificationSchedule" SET "leaseToken" = "leaseToken"
      WHERE "id" = ${key} AND "leaseToken" = ${lease.token} AND "scheduleVersion" = 1
        AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
    `;
    if (changed !== 1) throw failure("AUDIT_SCHEDULE_LEASE_LOST");
  }

  return {
    async start(take: number): Promise<Lease> {
      if (!Number.isSafeInteger(take) || take < 1 || take > 25) throw new RangeError("Invalid audit schedule batch size.");
      const token = randomUUID();
      return database.$transaction(async tx => {
        await tx.$executeRaw`
          INSERT INTO "AuditVerificationSchedule" ("id", "scheduleVersion")
          VALUES (${key}, 1) ON CONFLICT ("id") DO NOTHING
        `;
        const state = await lock(tx);
        if (state.leaseExpiresAt && state.leaseExpiresAt > state.databaseNow) throw failure("AUDIT_SCHEDULE_BUSY");
        const cursor = position(state.cursorTenantId, state.cursorCreatedAt);
        let upper = position(state.upperTenantId, state.upperCreatedAt);
        const newCycle = upper === null;
        if (newCycle) {
          upper = await tx.tenant.findFirst({
            orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, createdAt: true }
          });
        }
        // Fixed upper key makes a traversal finite even while new tenants are
        // added. Deleted cursor/upper tenants cannot break value-based paging.
        const page = upper === null ? [] : await tx.tenant.findMany({
          where: { AND: [
            { OR: [{ createdAt: { lt: upper.createdAt } }, { createdAt: upper.createdAt, id: { lte: upper.id } }] },
            ...(cursor ? [{ OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }] : [])
          ] },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: take + 1, // one metadata-only lookahead; never verified/hashed
          select: { id: true, createdAt: true }
        });
        await tx.auditVerificationSchedule.update({ where: { id: key }, data: {
          leaseToken: token, leaseExpiresAt: new Date(state.databaseNow.getTime() + LEASE_MS),
          ...(newCycle ? { upperTenantId: upper?.id ?? null, upperCreatedAt: upper?.createdAt ?? null,
            cycleStartedAt: state.databaseNow } : {})
        } });
        return { token, cursor, upper, tenants: page.slice(0, take), nextIndex: 0,
          endOfCycle: page.length <= take, finished: false };
      }, TRANSACTION);
    },

    async checkpoint<T>(lease: Lease, tenant: Position, persist: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
      const expected = lease.tenants[lease.nextIndex];
      if (!expected || !same(expected, tenant)) throw failure("AUDIT_SCHEDULE_ORDER_INVALID");
      const result = await database.$transaction(async tx => {
        owned(await lock(tx), lease);
        const value = await persist(tx);
        await fence(tx, lease);
        await tx.auditVerificationSchedule.update({ where: { id: key }, data: {
          cursorTenantId: tenant.id, cursorCreatedAt: tenant.createdAt
        } });
        return value;
      }, TRANSACTION);
      // Move the in-memory cursor only after the receipt AND cursor committed.
      lease.cursor = tenant;
      lease.nextIndex += 1;
      return result;
    },

    async finish(lease: Lease) {
      if (lease.nextIndex !== lease.tenants.length) throw failure("AUDIT_SCHEDULE_INCOMPLETE");
      await database.$transaction(async tx => {
        owned(await lock(tx), lease);
        await fence(tx, lease);
        await tx.auditVerificationSchedule.update({ where: { id: key }, data: {
          leaseToken: null, leaseExpiresAt: null,
          ...(lease.endOfCycle ? { cursorTenantId: null, cursorCreatedAt: null,
            upperTenantId: null, upperCreatedAt: null, cycleStartedAt: null,
            lastCycleCompletedAt: (await lock(tx)).databaseNow } : {})
        } });
      }, TRANSACTION);
      lease.finished = true;
      return { scheduleVersion: VERSION, selectionMode: "DURABLE_KEYSET" as const, cycleCompleted: lease.endOfCycle };
    },

    async release(lease: Lease) {
      if (lease.finished) return;
      // A late worker can release only its own lease, never a replacement's.
      // Cursor and cycle boundary are retained on errors/interruption.
      await database.auditVerificationSchedule.updateMany({
        where: { id: key, leaseToken: lease.token }, data: { leaseToken: null, leaseExpiresAt: null }
      });
    }
  };
}
