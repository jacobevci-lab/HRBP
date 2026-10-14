/** An invalid ledger is not a successful maintenance run, even when the
 * notification outbox safely recorded and queued an administrative alert. */
export function assertAuditIntegrityRun(result) {
  if (!result || !Number.isSafeInteger(result.failed) || result.failed < 0 ||
      !Number.isSafeInteger(result.tenantsChecked) || result.tenantsChecked < 0 ||
      result.failed > result.tenantsChecked) {
    const error = new Error("Invalid audit integrity monitoring result.");
    error.code = "AUDIT_INTEGRITY_RESULT_INVALID";
    throw error;
  }
  if (result.failed > 0) {
    const error = new Error("One or more audit integrity failures were detected. Review queued alerts.");
    error.code = "AUDIT_INTEGRITY_FAILURE";
    throw error;
  }
  return result;
}
