import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { summarizeCodeql } from "./summarize-codeql.mjs";

test("summary exposes only rule metadata and repository location", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "hrbp-codeql-"));
  try {
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "nested", "javascript.sarif"), JSON.stringify({
      runs: [{
        tool: { driver: { rules: [
          { id: "js/example-note", name: "Example note", properties: {} }
        ]}, extensions: [{ rules: [
          { id: "js/example-high", name: "Example high", properties: { "security-severity": "8.8" } }
        ]}] },
        results: [
          { ruleId: "js/example-note", level: "warning", message: { text: "DO NOT COPY secret fixture value" },
            locations: [{ physicalLocation: { artifactLocation: { uri: "lib/other.ts" }, region: { startLine: 9 }}}] },
          { ruleId: "js/example-high", level: "error", message: { text: "Sensitive source expression should not be emitted" },
            codeFlows: [{ threadFlows: [{ locations: [{ location: { message: { text: "tainted data" }}}] }]}],
            locations: [{ physicalLocation: { artifactLocation: { uri: "file:///home/runner/work/HRBP/HRBP/scripts/example.mjs" }, region: { startLine: 42 }}}] }
        ]
      }]
    }));
    const summary = await summarizeCodeql(root);
    assert.equal(summary.count, 2);
    assert.equal(summary.highOrCritical, 1);
    assert.deepEqual(summary.findings[0], {
      ruleId: "js/example-high", ruleName: "Example high", securitySeverity: 8.8,
      level: "error", path: "scripts/example.mjs", startLine: 42
    });
    const serialized = JSON.stringify(summary);
    assert.ok(!serialized.includes("Sensitive source"));
    assert.ok(!serialized.includes("DO NOT COPY"));
    assert.ok(!serialized.includes("tainted data"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("absolute paths outside the checkout are suppressed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "hrbp-codeql-"));
  try {
    await writeFile(path.join(root, "x.sarif"), JSON.stringify({runs:[{tool:{driver:{rules:[]}},results:[{
      ruleId:"x",locations:[{physicalLocation:{artifactLocation:{uri:"file:///etc/passwd"},region:{startLine:1}}}]
    }]}]}));
    const summary=await summarizeCodeql(root);
    assert.equal(summary.findings[0].path,null);
  } finally { await rm(root,{recursive:true,force:true}); }
});
