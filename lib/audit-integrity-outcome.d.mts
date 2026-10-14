export type AuditIntegrityRunSummary = {
  tenantsChecked: number;
  failed: number;
};

/** Fail after alerts have been queued when any tenant ledger is invalid. */
export declare function assertAuditIntegrityRun<T extends AuditIntegrityRunSummary>(result: T): T;
