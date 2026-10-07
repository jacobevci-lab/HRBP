import { readFileSync } from "node:fs";
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const payload = {
  root: lock.packages?.[""]?.dependencies?.nodemailer ?? null,
  package: lock.packages?.["node_modules/nodemailer"] ?? null
};
console.log("HRBP_NODEMAILER_LOCK_ENTRY_BEGIN");
console.log(JSON.stringify(payload));
console.log("HRBP_NODEMAILER_LOCK_ENTRY_END");
