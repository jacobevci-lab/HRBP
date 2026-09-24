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

  return <section className="card settings-security-editor-card">
    <SecurityPolicyEditor
      canWrite={can(ctx, "settings:write")}
      initial={{
        dataRegion: policy?.dataRegion ?? tenant.region,
        kmsKeyRef: policy?.kmsKeyRef ?? null,
        customerManagedKey: policy?.customerManagedKey ?? false,
        mfaRequired: policy?.mfaRequired ?? true,
        sessionMaxMinutes: policy?.sessionMaxMinutes ?? 480,
        exportRestrictedData: policy?.exportRestrictedData ?? false,
        downloadWatermarking: policy?.downloadWatermarking ?? true,
        deviceTrustRequired: policy?.deviceTrustRequired ?? false,
        breakGlassEnabled: policy?.breakGlassEnabled ?? true
      }}
    />
  </section>;
}
