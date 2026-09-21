import { databaseTransport, withDb } from "@/lib/db";

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
      latencyMs: Date.now() - startedAt
    });
  } catch (error) {
    console.error("Database health check failed", error);
    return Response.json(
      {
        status: "unavailable",
        database: "postgresql",
        transport: databaseTransport()
      },
      { status: 503 }
    );
  }
}
