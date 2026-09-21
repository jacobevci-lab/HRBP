import { readFile, writeFile } from "node:fs/promises";

const schemaPath = "prisma/schema.prisma";
const schema = await readFile(schemaPath, "utf8");

const generatorPattern = /generator\s+client\s*\{([\s\S]*?)\}/m;
const match = schema.match(generatorPattern);

if (!match) {
  throw new Error("Prisma client generator block not found");
}

if (/engineType\s*=\s*"client"/.test(match[0])) {
  console.log("Prisma Workers engineType already configured");
  process.exit(0);
}

const updatedGenerator = match[0].replace(
  /(provider\s*=\s*"prisma-client-js"\s*)/,
  '$1\n  engineType = "client"\n'
);

if (updatedGenerator === match[0]) {
  throw new Error("Unable to inject engineType into Prisma generator");
}

const updatedSchema = schema.replace(match[0], updatedGenerator);
await writeFile(schemaPath, updatedSchema, "utf8");
console.log('Prepared Prisma Client for Cloudflare Workers with engineType="client"');
