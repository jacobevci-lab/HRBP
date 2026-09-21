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

// Prisma 6 driver adapters require a normally generated client when the
// PrismaClient constructor receives an `adapter`. Keep the source schema
// unchanged and enable the driverAdapters preview feature only in this
// isolated Cloudflare/Hyperdrive generation schema.
const hyperdriveGenerator = `generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}`;

const updatedSchema = schema.replace(match[0], hyperdriveGenerator);
await writeFile(schemaPath, updatedSchema, "utf8");
console.log("Prepared Prisma schema for Cloudflare Hyperdrive driver adapter generation");
