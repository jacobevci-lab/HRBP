import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["prisma", "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma", "--script"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
);

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr || "");
  process.exit(result.status ?? 1);
}

const sql = result.stdout;
if (!sql.includes("CREATE TABLE") && !sql.includes("CREATE TYPE")) {
  throw new Error("Generated baseline SQL did not contain an expected schema statement.");
}
const payload = gzipSync(Buffer.from(sql, "utf8"), { level: 9 }).toString("base64");
console.log("HRBP_BASELINE_GZIP_BASE64_BEGIN");
console.log(payload);
console.log("HRBP_BASELINE_GZIP_BASE64_END");
