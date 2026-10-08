import { authenticationAssuranceConfiguration } from "@/lib/auth-assurance";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerRequestContext } from "@/lib/server-session";
import { SecurityPolicyEditor } from "@/components/security-policy-editor";

export async function SecurityPolicyEditorLoader() {
  const ctx = await getServerRequestContext();
  if (!ctx || !can(ctx, "settings:read")) return null;

  const [tenant, policy] = await Promise.all([
    db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { region: true } }),
    db.tenantSecurityPolicy.findUnique({ where: { tenantId: ctx.tenantId } })
  ]);
  if (!tenant) return null;

  const assurance = authenticationAssuranceConfiguration();

  return <section className="card settings-security-editor-card">
    <SecurityPolicyEditor
      canWrite={can(ctx, "settings:write")}
      assurance={{
        mfaConfigured: assurance.mfaConfigured,
        deviceTrustConfigured: assurance.deviceTrustConfigured,
        currentMfaSatisfied: ctx.mfaSatisfied === true,
        currentDeviceTrustSatisfied: ctx.deviceTrustSatisfied === true
      }}
      initial={{
        dataRegion: policy?.dataRegion ?? tenant.region,
        kmsKeyRef: policy?.kmsKeyRef ?? null,
        customerManagedKey: policy?.customerManagedKey ?? false,
        mfaRequired: Boolean(policy?.assuranceEnforcedAt && policy.mfaRequired),
        sessionMaxMinutes: policy?.sessionMaxMinutes ?? 480,
        exportRestrictedData: policy?.exportRestrictedData ?? false,
        downloadWatermarking: policy?.downloadWatermarking ?? true,
        deviceTrustRequired: Boolean(policy?.assuranceEnforcedAt && policy.deviceTrustRequired),
        breakGlassEnabled: policy?.breakGlassEnabled ?? true
      }}
    />
  </section>;
}
