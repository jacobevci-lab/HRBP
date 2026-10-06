import { spawnSync } from "node:child_process";
import pg from "pg";
import { PrismaClient } from "@prisma/client";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const appRole = process.env.HRBP_DB_APP_ROLE || "hrbp_app";
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(appRole)) throw new Error("Invalid runtime database role.");
const tenantId = process.env.HRBP_AUTH_TENANT_ID?.trim();
const tenantName = process.env.HRBP_TENANT_NAME?.trim();
const tenantRegion = process.env.HRBP_TENANT_REGION?.trim();
if (!tenantId || !tenantName || !tenantRegion) throw new Error("Tenant bootstrap settings are required.");

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const existing = await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
  if (Number(existing.rows[0]?.count || 0) !== 0) throw new Error("Bootstrap refused: target database is not empty. Use a reviewed migration release for upgrades.");
} finally {
  await client.end();
}

const pushed = spawnSync("npm", ["run", "db:push"], { stdio: "inherit", env: process.env });
if (pushed.error || pushed.status !== 0) throw new Error("Prisma schema bootstrap failed.");

const grantClient = new Client({ connectionString: databaseUrl });
await grantClient.connect();
try {
  const role = `"${appRole.replaceAll('"', '""')}"`;
  for (const statement of [
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`
  ]) await grantClient.query(statement);
} finally {
  await grantClient.end();
}

const prisma = new PrismaClient();
try {
  await prisma.tenant.create({ data: { id: tenantId, name: tenantName, region: tenantRegion } });
} finally {
  await prisma.$disconnect();
}
console.log(JSON.stringify({ ok: true, mode: "install-only", tenantId }));
