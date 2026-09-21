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

// Cloudflare Hyperdrive's documented Prisma 6 setup uses prisma-client-js
// with the driverAdapters preview feature and a --no-engine generation.
// Keep the source schema unchanged and generate from this isolated copy.
const hyperdriveGenerator = `generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}`;

const updatedSchema = schema.replace(match[0], hyperdriveGenerator);
await writeFile(schemaPath, updatedSchema, "utf8");
console.log("Prepared Prisma schema for Cloudflare Hyperdrive driver adapter generation");
