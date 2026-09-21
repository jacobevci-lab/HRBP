import { databaseTransport, withDb } from "@/lib/db";

function classify(message: string) {
  const value = message.toLowerCase();
  if (value.includes("engine") || value.includes("prisma") || value.includes("adapter")) return "prisma_runtime";
  if (value.includes("password") || value.includes("authentication") || value.includes("sasl")) return "authentication";
  if (value.includes("certificate") || value.includes("ssl") || value.includes("tls")) return "tls";
  if (value.includes("connect") || value.includes("timeout") || value.includes("socket") || value.includes("network")) return "network";
  return "unknown";
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
      latencyMs: Date.now() - startedAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Database health check failed", error);
    return Response.json(
      {
        status: "unavailable",
        database: "postgresql",
        transport: databaseTransport(),
        orm: "prisma",
        reason: classify(message)
      },
      { status: 503 }
    );
  }
}
