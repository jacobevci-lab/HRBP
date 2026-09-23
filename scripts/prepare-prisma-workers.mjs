import { cp, readFile, rm, writeFile } from "node:fs/promises";

const sourceDir = "prisma";
const workerDir = ".prisma-worker";
const schemaPath = `${workerDir}/schema.prisma`;

await rm(workerDir, { recursive: true, force: true });
await cp(sourceDir, workerDir, { recursive: true });

const schema = await readFile(schemaPath, "utf8");
const generatorPattern = /generator\s+client\s*\{([\s\S]*?)\}/m;
const match = schema.match(generatorPattern);

if (!match) {
  throw new Error("Prisma client generator block not found");
}

// Cloudflare Workers cannot execute Prisma's native Rust query-engine binary.
// Prisma 6.16+ supports an engine-less JavaScript client through
// `engineType = "client"`; this pairs with the @prisma/adapter-pg instance
// created in lib/db.ts and keeps platform-specific OpenSSL binaries out of the
// Worker bundle. Keep this isolated to the generated Worker schema so normal
// Prisma CLI/database workflows can continue using the source schema.
const hyperdriveGenerator = `generator client {
  provider        = "prisma-client-js"
  engineType      = "client"
  previewFeatures = ["driverAdapters"]
}`;

const updatedSchema = schema.replace(match[0], hyperdriveGenerator);
await writeFile(schemaPath, updatedSchema, "utf8");
console.log("Prepared engine-less Prisma schema for Cloudflare Hyperdrive driver adapter generation");
