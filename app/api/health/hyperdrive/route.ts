import { getCloudflareContext } from "@opennextjs/cloudflare";
import { Client } from "pg";

type HyperdriveBinding = { connectionString: string };
type RuntimeEnv = { HYPERDRIVE?: HyperdriveBinding };

function classify(message: string) {
  const value = message.toLowerCase();
  if (value.includes("password") || value.includes("authentication") || value.includes("sasl")) return "authentication";
  if (value.includes("certificate") || value.includes("ssl") || value.includes("tls")) return "tls";
  if (value.includes("connect") || value.includes("timeout") || value.includes("socket") || value.includes("network")) return "network";
  if (value.includes("module") || value.includes("driver") || value.includes("unsupported")) return "driver";
  return "unknown";
}

export async function GET() {
  const startedAt = Date.now();

  try {
    const env = getCloudflareContext().env as unknown as RuntimeEnv;
    if (!env.HYPERDRIVE?.connectionString) {
      return Response.json({ status: "unavailable", transport: "hyperdrive", reason: "binding_missing" }, { status: 503 });
    }

    const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
    try {
      await client.connect();
      const result = await client.query<{ ok: number }>("SELECT 1::int AS ok");
      return Response.json({
        status: result.rows[0]?.ok === 1 ? "ok" : "unexpected",
        transport: "hyperdrive",
        driver: "pg",
        latencyMs: Date.now() - startedAt
      });
    } finally {
      await client.end().catch(() => undefined);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Hyperdrive health check failed", error);
    return Response.json(
      { status: "unavailable", transport: "hyperdrive", driver: "pg", reason: classify(message) },
      { status: 503 }
    );
  }
}
