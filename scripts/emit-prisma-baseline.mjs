import { readFileSync } from "node:fs";

const lock = readFileSync("package-lock.json");
console.log("HRBP_PACKAGE_LOCK_BASE64_BEGIN");
console.log(lock.toString("base64"));
console.log("HRBP_PACKAGE_LOCK_BASE64_END");
