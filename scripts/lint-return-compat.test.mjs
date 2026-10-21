/** Exercise the real project config, not only rule names or an isolated mock. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { FlatCompat } from '@eslint/eslintrc';
import path from 'node:path';
const engine = new ESLint();
async function lint(code, filePath) {
  const [result] = await engine.lintText(code, { filePath });
  assert.ok(result, 'The file must be linted, not silently ignored.');
  assert.equal(result.fatalErrorCount, 0);
  assert.ok(!result.messages.some(m => /ignored|configuration was supplied/.test(m.message)));
  return result;
}
test('ordinary API return statements run through every enabled Next rule without crashing', async () => {
  const result = await lint('export function GET() { return Response.json({ ok: true }); }', 'app/api/compat-fixture/route.ts');
  assert.equal(result.errorCount, 0);
});
test('the exact API route from the CI stack can be linted without a rule API exception', async () => {
  const results = await engine.lintFiles(['app/api/action-center/history/export/route.ts']);
  assert.equal(results.length, 1);
  assert.equal(results[0].fatalErrorCount, 0);
});
for (const [heads, violations] of [[1, 0], [2, 1], [3, 2]]) {
  test(`actual config detects ${violations} duplicate Head violations in a ${heads}-Head document`, async () => {
    const code = `import Document, { Html, Head, Main, NextScript } from 'next/document';\nexport default class Example extends Document { render() { return <Html>${'<Head />'.repeat(heads)}<body><Main /><NextScript /></body></Html>; } }`;
    const result = await lint(code, 'pages/_document.tsx');
    const findings = result.messages.filter(m => m.ruleId === '@next/next/no-duplicate-head');
    assert.equal(findings.length, violations);
    assert.ok(findings.every(m => m.severity === 2));
  });
}
test('the compatibility layer preserves every configured rule severity and option', async () => {
  const before = new ESLint({ overrideConfigFile: true, overrideConfig: new FlatCompat({ baseDirectory: process.cwd() }).extends('next/core-web-vitals', 'next/typescript') });
  for (const filename of ['components/session-indicator.tsx', 'app/api/action-center/history/export/route.ts']) {
    const [raw, actual] = await Promise.all([before.calculateConfigForFile(filename), engine.calculateConfigForFile(filename)]);
    assert.deepEqual(actual.rules, raw.rules);
    assert.deepEqual(Object.keys(actual.plugins).sort(), Object.keys(raw.plugins).sort());
  }
});
test('existing Next, React and TypeScript findings remain enforced through the actual config', async () => {
  for (const [file, code, rule] of [
    ['app/api/compat-fixture/route.ts', 'let module = {};', '@next/next/no-assign-module-variable'],
    ['components/compat-fixture.tsx', 'export function Example() { return <script src="/test.js" />; }', '@next/next/no-sync-scripts'],
    ['components/compat-fixture.tsx', 'export function Example() { return <img src="/test.png" alt="Test" />; }', '@next/next/no-img-element'],
    ['lib/compat-fixture.ts', 'export type Example = any;', '@typescript-eslint/no-explicit-any'],
    ['components/compat-fixture.tsx', 'export function Example() { return [<div />]; }', 'react/jsx-key']
  ]) {
    const result = await lint(code, file);
    assert.ok(result.messages.some(m => m.ruleId === rule), `${rule} must still produce a diagnostic`);
  }
});
test('generated Next output remains ignored, application source does not', async () => {
  assert.equal(await engine.isPathIgnored(path.resolve('.next/server/ignored.js')), true);
  assert.equal(await engine.isPathIgnored(path.resolve('components/session-indicator.tsx')), false);
});
