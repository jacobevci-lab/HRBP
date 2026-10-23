import { readdir, readFile, mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function safePath(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replaceAll("\\", "/").replace(/^file:\/\//, "");
  const marker = "/HRBP/";
  const index = normalized.lastIndexOf(marker);
  const relative = index >= 0 ? normalized.slice(index + marker.length) : normalized.replace(/^\.\.\//, "");
  if (!relative || relative.startsWith("/") || relative.includes("../")) return null;
  return relative.slice(0, 300);
}
function securitySeverity(rule) {
  const number = Number(rule?.properties?.["security-severity"]);
  return Number.isFinite(number) ? number : null;
}
async function filesUnder(root) {
  const info = await stat(root);
  if (info.isFile()) return root.endsWith(".sarif") ? [root] : [];
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(target));
    else if (entry.isFile() && entry.name.endsWith(".sarif")) output.push(target);
  }
  return output;
}
export async function summarizeCodeql(inputPath) {
  const findings = [];
  for (const file of await filesUnder(inputPath)) {
    const sarif = JSON.parse(await readFile(file, "utf8"));
    for (const run of Array.isArray(sarif.runs) ? sarif.runs : []) {
      const ruleSets = [run.tool?.driver?.rules ?? [], ...(run.tool?.extensions ?? []).map(extension => extension?.rules ?? [])];\n      const rules = new Map(ruleSets.flat().map(rule => [rule.id, rule]));
      for (const result of Array.isArray(run.results) ? run.results : []) {
        const rule = rules.get(result.ruleId);
        const location = result.locations?.[0]?.physicalLocation;
        const filePath = safePath(location?.artifactLocation?.uri);
        const startLine = Number(location?.region?.startLine);
        findings.push({
          ruleId: typeof result.ruleId === "string" ? result.ruleId.slice(0, 160) : "unknown",
          ruleName: typeof rule?.name === "string" ? rule.name.slice(0, 200) : null,
          securitySeverity: securitySeverity(rule),
          level: typeof result.level === "string" ? result.level : null,
          path: filePath,
          startLine: Number.isSafeInteger(startLine) && startLine > 0 ? startLine : null
        });
      }
    }
  }
  findings.sort((a,b) => (b.securitySeverity ?? -1) - (a.securitySeverity ?? -1) ||
    String(a.path).localeCompare(String(b.path)) || (a.startLine ?? 0) - (b.startLine ?? 0));
  return {
    source: process.env.GITHUB_SHA ?? null,
    scope: "sanitized-codeql-result-metadata-no-source-snippets-no-dataflow",
    count: findings.length,
    highOrCritical: findings.filter(row => (row.securitySeverity ?? 0) >= 7).length,
    findings
  };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error("Usage: summarize-codeql.mjs <sarif-file-or-dir> <output-json>");
  const summary = await summarizeCodeql(inputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(summary, null, 2) + "\n");
  console.log(`CODEQL_SUMMARY count=${summary.count} highOrCritical=${summary.highOrCritical}`);\n  console.log(`CODEQL_FINDINGS ${JSON.stringify(summary.findings)}`);
}
