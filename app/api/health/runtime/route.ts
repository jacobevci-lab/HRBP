import { getCloudflareContext } from "@opennextjs/cloudflare";
import { normalizedProviderVersionId, runtimeHealth } from "@/lib/runtime-health.mjs";

export const dynamic = "force-dynamic";

type ProviderVersionMetadata = { id?: unknown };
type ProviderRuntimeEnv = { CF_VERSION_METADATA?: ProviderVersionMetadata };

function providerVersionId() {
  try {
    const env = getCloudflareContext().env as unknown as ProviderRuntimeEnv;
    return normalizedProviderVersionId(env.CF_VERSION_METADATA?.id);
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const probe = new URL(request.url).searchParams.get("probe");
  const health = runtimeHealth(process.env.HRBP_BUILD_REVISION, probe);
  const versionId = providerVersionId();
  return Response.json({
    ...health,
    release: versionId ? { ...health.release, providerVersionId: versionId } : health.release
  }, {
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}
