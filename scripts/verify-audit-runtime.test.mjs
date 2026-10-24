import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyAuditRuntime } from './verify-audit-runtime.mjs';
function fixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'hrbp-runtime-fixture-'));
  const write = (file, value) => { const p = path.join(root, file); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(value)); };
  const dependencies = { next: '^15.2.4', react: '^19.0.0', '@scope/runtime': '^1.0.0' };
  const pkg = { name: 'fixture', version: '1.0.0', dependencies };
  const lock = { lockfileVersion: 3, packages: { '': structuredClone(pkg), 'node_modules/next': { version: '15.5.27' },
    'node_modules/react': { version: '19.3.0' }, 'node_modules/@scope/runtime': { version: '1.0.0' } } };
  write('package.json', pkg); write('package-lock.json', lock);
  for (const [location, value] of Object.entries(lock.packages)) if (location) write(`${location}/package.json`, { name: location.slice(13), version: value.version });
  try { return run({ root, write, pkg, lock }); } finally { rmSync(root, { recursive: true, force: true }); }
}
test('runtime check accepts exact scoped and unscoped root versions without rewriting inputs', () => fixture(({ root }) => {
  const before = readFileSync(path.join(root, 'package-lock.json'), 'utf8');
  const result = verifyAuditRuntime(root); assert.equal(result.packages.length, 3); assert.match(result.packageLockSha256, /^[a-f0-9]{64}$/);
  assert.equal(readFileSync(path.join(root, 'package-lock.json'), 'utf8'), before);
}));
test('runtime check rejects a semver-compatible Next.js upgrade after browser installation', () => fixture(({ root, write }) => {
  write('node_modules/next/package.json', { name: 'next', version: '15.5.28' });
  assert.throws(() => verifyAuditRuntime(root), /expected 15\.5\.27, observed 15\.5\.28/);
}));
test('runtime check rejects an installed package with the right version but a wrong identity', () => fixture(({ root, write }) => {
  write('node_modules/react/package.json', { name: 'other-package', version: '19.3.0' }); assert.throws(() => verifyAuditRuntime(root), /differs/);
}));
test('runtime check rejects a missing package rather than reporting partial success', () => fixture(({ root }) => {
  rmSync(path.join(root, 'node_modules/react'), { recursive: true }); assert.throws(() => verifyAuditRuntime(root));
}));
test('runtime check rejects manifest/lock declaration drift', () => fixture(({ root, pkg, write }) => {
  pkg.dependencies.next = '^16.0.0'; write('package.json', pkg); assert.throws(() => verifyAuditRuntime(root), /declarations differ/);
}));
test('runtime check rejects unsupported lock versions', () => fixture(({ root, lock, write }) => {
  lock.lockfileVersion = 1; write('package-lock.json', lock); assert.throws(() => verifyAuditRuntime(root), /v2\/v3/);
}));
test('runtime check rejects unprovable linked root packages', () => fixture(({ root, lock, write }) => {
  lock.packages['node_modules/next'].link = true; write('package-lock.json', lock); assert.throws(() => verifyAuditRuntime(root), /Unsupported/);
}));
for (const file of ['.github/workflows/ui-deep-inspection.yml', '.github/workflows/platform-regression.yml']) {
  test(`${file}: browser tools are outside the application dependency graph and versions are checked`, () => {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /npm ci/);
    assert.match(source, /mktemp -d "\$RUNNER_TEMP\/hrbp-browser-tools\.XXXXXX"/);
    assert.match(source, /npm install --prefix "\$tool_dir" --ignore-scripts --no-save --package-lock=false playwright@1\.56\.1/);
    assert.match(source, /ln -s "\$tool_dir\/node_modules\/playwright" node_modules\/playwright/);
    assert.match(source, /node scripts\/verify-audit-runtime\.mjs > \.audit\/browser-runtime\.json/);
    assert.doesNotMatch(source, /npm install --no-save --package-lock=false playwright/);
    assert.match(source, /test "\$lock_sha" = "\$\(sha256sum package-lock\.json\)"/);
  });
}
