import { runtimeHealth } from "@/lib/runtime-health.mjs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const probe = new URL(request.url).searchParams.get("probe");
  return Response.json(runtimeHealth(process.env.HRBP_BUILD_REVISION, probe), {
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}
