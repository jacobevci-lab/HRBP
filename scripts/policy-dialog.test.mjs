/** Scroll-lock ownership unit tests. Keyboard/rendering evidence is separate. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync('components/use-policy-dialog.ts', 'utf8');
const output = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
} }).outputText;
const module = { exports: {} };
new Function('module', 'exports', 'require', output)(module, module.exports, name => {
  assert.equal(name, 'react'); return { useEffect() {} };
});
const { acquirePolicyPageScroll } = module.exports;
class Style {
  constructor(initial = {}) { this.entries = new Map(Object.entries(initial).map(([key, value]) => [key, { value, priority: '' }])); }
  getPropertyValue(key) { return this.entries.get(key)?.value ?? ''; }
  getPropertyPriority(key) { return this.entries.get(key)?.priority ?? ''; }
  setProperty(key, value, priority = '') { this.entries.set(key, { value, priority }); }
  removeProperty(key) { const value = this.getPropertyValue(key); this.entries.delete(key); return value; }
}
function documentFixture() { return { documentElement: { style: new Style() }, body: { style: new Style() } }; }
function locked(doc) {
  for (const element of [doc.documentElement, doc.body].filter(Boolean)) {
    for (const key of ['overflow-x', 'overflow-y']) {
      assert.equal(element.style.getPropertyValue(key), 'hidden');
      assert.equal(element.style.getPropertyPriority(key), 'important');
    }
  }
}
function unlocked(doc) {
  for (const element of [doc.documentElement, doc.body].filter(Boolean)) {
    for (const key of ['overflow-x', 'overflow-y']) assert.equal(element.style.getPropertyValue(key), '');
  }
}
test('page lock covers both roots and restores absent inline declarations', () => {
  const doc = documentFixture(), release = acquirePolicyPageScroll(doc); locked(doc); release(); unlocked(doc);
});
test('independent modal owners keep scroll locked until the last release', () => {
  const doc = documentFixture(), first = acquirePolicyPageScroll(doc), second = acquirePolicyPageScroll(doc);
  first(); locked(doc); second(); unlocked(doc);
});
test('cleanup is idempotent and cannot release another active owner', () => {
  const doc = documentFixture(), first = acquirePolicyPageScroll(doc), second = acquirePolicyPageScroll(doc);
  first(); first(); locked(doc); second(); second(); unlocked(doc);
});
test('original values and priorities survive acquisition and release', () => {
  const doc = documentFixture();
  doc.body.style.setProperty('overflow-y', 'scroll', 'important');
  doc.documentElement.style.setProperty('overflow-x', 'auto');
  const release = acquirePolicyPageScroll(doc); locked(doc); release();
  assert.equal(doc.body.style.getPropertyValue('overflow-y'), 'scroll');
  assert.equal(doc.body.style.getPropertyPriority('overflow-y'), 'important');
  assert.equal(doc.documentElement.style.getPropertyValue('overflow-x'), 'auto');
  assert.equal(doc.documentElement.style.getPropertyPriority('overflow-x'), '');
});
test('a later external overflow change is not overwritten by cleanup', () => {
  const doc = documentFixture(), release = acquirePolicyPageScroll(doc);
  doc.body.style.setProperty('overflow-y', 'clip', 'important');
  doc.documentElement.style.setProperty('overflow-x', 'hidden', '');
  release();
  assert.equal(doc.body.style.getPropertyValue('overflow-y'), 'clip');
  assert.equal(doc.documentElement.style.getPropertyPriority('overflow-x'), '');
  assert.equal(doc.documentElement.style.getPropertyValue('overflow-x'), 'hidden');
});
test('unrelated style changes are preserved without cssText restoration', () => {
  const doc = documentFixture(); doc.body.style.setProperty('color', 'initial');
  const release = acquirePolicyPageScroll(doc); doc.body.style.setProperty('color', 'changed'); release();
  assert.equal(doc.body.style.getPropertyValue('color'), 'changed');
});
test('locks are isolated by document and handle a missing body', () => {
  const first = documentFixture(), second = documentFixture(); second.body = null;
  const a = acquirePolicyPageScroll(first), b = acquirePolicyPageScroll(second);
  a(); unlocked(first); locked(second); b(); unlocked(second);
});
test('a subsequent acquisition snapshots the latest unlocked state', () => {
  const doc = documentFixture(); acquirePolicyPageScroll(doc)();
  doc.body.style.setProperty('overflow-y', 'auto');
  const release = acquirePolicyPageScroll(doc); locked(doc); release();
  assert.equal(doc.body.style.getPropertyValue('overflow-y'), 'auto');
});
