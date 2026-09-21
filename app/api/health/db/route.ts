import { databaseTransport, withDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DIAGNOSTIC_VERSION = "db-health-v3";
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0"
};

function classify(message: string) {
  const value = message.toLowerCase();
  if (value.includes("engine") || value.includes("prisma") || value.includes("adapter")) return "prisma_runtime";
  if (value.includes("password") || value.includes("authentication") || value.includes("sasl")) return "authentication";
  if (value.includes("certificate") || value.includes("ssl") || value.includes("tls")) return "tls";
  if (value.includes("connect") || value.includes("timeout") || value.includes("socket") || value.includes("network")) return "network";
  return "unknown";
}

function errorMetadata(error: unknown) {
  if (!(error instanceof Error)) return { errorName: "UnknownError" };
  const value = error as Error & { code?: string };
  return {
    errorName: value.name || "Error",
    ...(value.code ? { errorCode: String(value.code) } : {})
  };
}

export async function GET() {
  const startedAt = Date.now();

  try {
    await withDb(async db => {
      await db.$queryRaw`SELECT 1`;
    });

    return Response.json(
      {
        status: "ok",
        database: "postgresql",
        transport: databaseTransport(),
        orm: "prisma",
        diagnosticVersion: DIAGNOSTIC_VERSION,
        latencyMs: Date.now() - startedAt
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Database health check failed", error);
    return Response.json(
      {
        status: "unavailable",
        database: "postgresql",
        transport: databaseTransport(),
        orm: "prisma",
        diagnosticVersion: DIAGNOSTIC_VERSION,
        reason: classify(message),
        ...errorMetadata(error)
      },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }
}
