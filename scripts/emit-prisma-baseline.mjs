import { readFileSync } from "node:fs";

const payload = readFileSync("package-lock.json").toString("base64");
console.log("HRBP_PACKAGE_LOCK_BASE64_BEGIN");
for (let i = 0; i < payload.length; i += 4096) {
  console.log(payload.slice(i, i + 4096));
}
console.log("HRBP_PACKAGE_LOCK_BASE64_END");
