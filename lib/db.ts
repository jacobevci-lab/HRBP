import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

type HyperdriveBinding = { connectionString: string };
type RuntimeEnv = {
  HYPERDRIVE?: HyperdriveBinding;
  DATABASE_URL?: string;
};

function runtimeEnv(): RuntimeEnv | null {
  try {
    return getCloudflareContext().env as unknown as RuntimeEnv;
  } catch {
    return null;
  }
}

export function databaseTransport(): "hyperdrive" | "direct" | "unconfigured" {
  const env = runtimeEnv();
  if (env?.HYPERDRIVE?.connectionString) return "hyperdrive";
  if (env?.DATABASE_URL || process.env.DATABASE_URL) return "direct";
  return "unconfigured";
}

function connectionString(): string {
  const env = runtimeEnv();
  const url = env?.HYPERDRIVE?.connectionString ?? env?.DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Database connection is not configured.");
  return url;
}

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: connectionString() });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });
}

export async function withDb<T>(operation: (client: PrismaClient) => Promise<T>): Promise<T> {
  const client = createClient();
  try {
    return await operation(client);
  } finally {
    await client.$disconnect();
  }
}

function modelDelegate(model: string) {
  return new Proxy({}, {
    get(_target, method) {
      if (typeof method !== "string") return undefined;
      return (...args: unknown[]) => withDb(async client => {
        const delegate = (client as unknown as Record<string, Record<string, (...values: unknown[]) => unknown>>)[model];
        if (!delegate || typeof delegate[method] !== "function") {
          throw new Error(`Unsupported Prisma delegate operation: ${model}.${method}`);
        }
        return await delegate[method](...args);
      });
    }
  });
}

/**
 * Compatibility proxy used by the existing API routes.
 *
 * Each operation gets a fresh Prisma client. Hyperdrive owns database connection
 * pooling while the generated Prisma client targets workerd explicitly.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, property) {
    if (typeof property !== "string") return undefined;

    if (property.startsWith("$")) {
      return (...args: unknown[]) => withDb(async client => {
        const operation = (client as unknown as Record<string, (...values: unknown[]) => unknown>)[property];
        if (typeof operation !== "function") throw new Error(`Unsupported Prisma operation: ${property}`);
        return await operation.apply(client, args);
      });
    }

    return modelDelegate(property);
  }
});
