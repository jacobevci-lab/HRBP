import { databaseTransport, withDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function classify(message: string) {
  const value = message.toLowerCase();
  if (value.includes("enoent") || value.includes("query_compiler") || value.includes("wasm")) return "prisma_wasm_runtime";
  if (value.includes("adapter") || value.includes("prisma") || value.includes("engine")) return "prisma_runtime";
  if (value.includes("password") || value.includes("authentication") || value.includes("sasl")) return "authentication";
  if (value.includes("certificate") || value.includes("ssl") || value.includes("tls")) return "tls";
  if (value.includes("connect") || value.includes("timeout") || value.includes("socket") || value.includes("network")) return "network";
  return "unknown";
}

function safeDetail(message: string) {
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-database-url]")
    .replace(/password\s*[=:]\s*[^\s,;]+/gi, "password=[redacted]")
    .slice(0, 320);
}

export async function GET() {
  const startedAt = Date.now();

  try {
    await withDb(async db => {
      await db.$queryRaw`SELECT 1`;
    });

    return Response.json({
      status: "ok",
      database: "postgresql",
      transport: databaseTransport(),
      orm: "prisma",
      diagnosticVersion: "db-health-v6-engine-adapter",
      latencyMs: Date.now() - startedAt
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const candidate = error as { name?: string; code?: string };
    console.error("Database health check failed", error);
    return Response.json(
      {
        status: "unavailable",
        database: "postgresql",
        transport: databaseTransport(),
        orm: "prisma",
        diagnosticVersion: "db-health-v6-engine-adapter",
        reason: classify(message),
        errorName: candidate?.name ?? "unknown",
        errorCode: candidate?.code ?? null,
        detail: safeDetail(message)
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
