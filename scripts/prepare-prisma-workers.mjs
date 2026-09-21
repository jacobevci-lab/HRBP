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

const workerGenerator = `generator client {
  provider   = "prisma-client"
  output     = "../generated/prisma"
  engineType = "client"
  runtime    = "workerd"
  moduleFormat = "esm"
}`;

const updatedSchema = schema.replace(match[0], workerGenerator);
await writeFile(schemaPath, updatedSchema, "utf8");
console.log("Prepared isolated Prisma Client schema for Cloudflare Workers (workerd runtime)");
