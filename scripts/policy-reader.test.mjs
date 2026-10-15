import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync('components/policy-acknowledgement-reader.tsx', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const module = { exports: {} };
new Function('module', 'exports', 'require', compiled)(module, module.exports, name => {
  assert.ok(['react', 'react/jsx-runtime', 'lucide-react', '@/components/locale-provider', './policy-acknowledgement-reader.module.css'].includes(name), name); return {};
});
const { checkedPolicySnapshot } = module.exports;
const make = text => ({ id: 'p', title: 'Synthetic policy', version: '1.0', contentMarkdown: text, contentHash: createHash('sha256').update(text).digest('hex') });
test('reader snapshot: verifies the exact UTF-8 text digest without executing markup', async () => {
  const value = make('Türkçe politika\n<img src="https://example.invalid/pixel" onerror="alert(1)">');
  assert.deepEqual(await checkedPolicySnapshot(value, 'p'), value);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML\s*=/);
});
for (const [name, value] of [
  ['null', null], ['array', []], ['wrong id', { ...make('test'), id: 'q' }],
  ['missing version', { ...make('test'), version: '' }], ['missing title', { ...make('test'), title: null }],
  ['empty content', make('')], ['wrong hash', { ...make('test'), contentHash: '0'.repeat(64) }],
  ['hash field type', { ...make('test'), contentHash: 123 }], ['changed bytes', { ...make('test'), contentMarkdown: 'changed' }],
  ['oversized text', make('x'.repeat(65537))], ['oversized UTF8', make('ğ'.repeat(32769))]
]) test(`reader snapshot: ${name} cannot enable acknowledgement`, async () => { assert.equal(await checkedPolicySnapshot(value, 'p'), null); });
test('reader snapshot: exact UTF8 byte limit remains valid', async () => {
  const value = make('ğ'.repeat(32768)); assert.deepEqual(await checkedPolicySnapshot(value, 'p'), value);
});
test('reader: uses private explicit reads and preserves mounted action state across consent/close', () => {
  assert.match(source, /cache: "no-store"/); assert.match(source, /credentials: "same-origin"/); assert.match(source, /redirect: "error"/);
  assert.match(source, /<fieldset disabled=\{!read\}/); assert.match(source, /onClose=\{closed\}/);
  assert.doesNotMatch(source, /read && renderAction/); assert.match(source, /currentId\.current !== policyId/);
});
