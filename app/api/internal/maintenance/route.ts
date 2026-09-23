import { internalBearerAuthorized } from "@/lib/internal-auth";
import { runOperationalMaintenance } from "@/lib/operational-maintenance";

export async function POST(request: Request) {
  if (!internalBearerAuthorized(request, "HRBP_MAINTENANCE_TOKEN")) {
    return Response.json({ error: "Valid internal maintenance credentials are required." }, { status: 401 });
  }
  const data = await runOperationalMaintenance();
  return Response.json({ data });
}
