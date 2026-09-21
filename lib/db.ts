import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient as RuntimePrismaClient } from "@/generated/prisma/client";
import type { PrismaClient as AppPrismaClient } from "@prisma/client";

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

function createRuntimeClient(): RuntimePrismaClient {
  const adapter = new PrismaPg({ connectionString: connectionString() });
  return new RuntimePrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });
}

/**
 * Application code still uses @prisma/client types for its transaction helpers
 * and enum imports. The Worker runtime uses the generated workerd Prisma client.
 * Both clients are generated from the same schema, so we expose the runtime client
 * through the legacy application type surface while keeping the implementation
 * Cloudflare-compatible.
 */
function asAppClient(client: RuntimePrismaClient): AppPrismaClient {
  return client as unknown as AppPrismaClient;
}

export async function withDb<T>(operation: (client: AppPrismaClient) => Promise<T>): Promise<T> {
  const runtimeClient = createRuntimeClient();
  try {
    return await operation(asAppClient(runtimeClient));
  } finally {
    await runtimeClient.$disconnect();
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
 * The proxy is intentionally typed as the application's @prisma/client instance
 * so transaction callbacks and helper signatures remain type-compatible. At
 * runtime every operation is executed by the workerd-generated Prisma client.
 */
export const db = new Proxy({} as AppPrismaClient, {
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
