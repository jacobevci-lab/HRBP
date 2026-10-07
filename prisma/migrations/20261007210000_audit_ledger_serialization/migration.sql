ALTER TABLE "AuditEvent"
  ADD COLUMN "ledgerSequence" BIGINT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AuditEvent"
    GROUP BY "tenantId", "hash"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Audit ledger migration refused: duplicate tenant/hash values exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "AuditEvent"
    WHERE "previousHash" IS NOT NULL
    GROUP BY "tenantId", "previousHash"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Audit ledger migration refused: an existing ledger fork was detected.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        "tenantId",
        COUNT(*) FILTER (WHERE "previousHash" IS NULL) AS root_count
      FROM "AuditEvent"
      GROUP BY "tenantId"
    ) roots
    WHERE root_count <> 1
  ) THEN
    RAISE EXCEPTION 'Audit ledger migration refused: each non-empty tenant ledger must have exactly one root.';
  END IF;
END $$;

WITH RECURSIVE audit_chain AS (
  SELECT
    event."id",
    event."tenantId",
    event."hash",
    event."previousHash",
    1::BIGINT AS ledger_sequence
  FROM "AuditEvent" event
  WHERE event."previousHash" IS NULL

  UNION ALL

  SELECT
    child."id",
    child."tenantId",
    child."hash",
    child."previousHash",
    parent.ledger_sequence + 1
  FROM "AuditEvent" child
  INNER JOIN audit_chain parent
    ON child."tenantId" = parent."tenantId"
   AND child."previousHash" = parent."hash"
)
UPDATE "AuditEvent" event
SET "ledgerSequence" = chain.ledger_sequence
FROM audit_chain chain
WHERE event."id" = chain."id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AuditEvent"
    WHERE "ledgerSequence" IS NULL
  ) THEN
    RAISE EXCEPTION 'Audit ledger migration refused: one or more events are disconnected from the tenant root.';
  END IF;
END $$;

ALTER TABLE "AuditEvent"
  ALTER COLUMN "ledgerSequence" SET NOT NULL;

CREATE UNIQUE INDEX "AuditEvent_tenantId_ledgerSequence_key"
  ON "AuditEvent"("tenantId", "ledgerSequence");

CREATE UNIQUE INDEX "AuditEvent_tenantId_hash_key"
  ON "AuditEvent"("tenantId", "hash");

CREATE UNIQUE INDEX "AuditEvent_tenantId_previousHash_key"
  ON "AuditEvent"("tenantId", "previousHash");

CREATE TABLE "AuditLedgerState" (
  "tenantId" TEXT NOT NULL,
  "tailHash" TEXT,
  "eventCount" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AuditLedgerState_pkey" PRIMARY KEY ("tenantId"),
  CONSTRAINT "AuditLedgerState_eventCount_nonnegative" CHECK ("eventCount" >= 0),
  CONSTRAINT "AuditLedgerState_tail_consistency" CHECK (
    ("eventCount" = 0 AND "tailHash" IS NULL)
    OR
    ("eventCount" > 0 AND "tailHash" IS NOT NULL)
  )
);

ALTER TABLE "AuditLedgerState"
  ADD CONSTRAINT "AuditLedgerState_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "AuditLedgerState" ("tenantId", "tailHash", "eventCount", "updatedAt")
SELECT
  event."tenantId",
  event."hash",
  event."ledgerSequence",
  CURRENT_TIMESTAMP
FROM "AuditEvent" event
INNER JOIN (
  SELECT "tenantId", MAX("ledgerSequence") AS max_sequence
  FROM "AuditEvent"
  GROUP BY "tenantId"
) tails
  ON tails."tenantId" = event."tenantId"
 AND tails.max_sequence = event."ledgerSequence";
