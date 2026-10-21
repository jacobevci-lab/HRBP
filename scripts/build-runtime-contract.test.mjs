/** Build-policy checks supplement, never replace, actual Next/Worker builds. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(file, 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
test('application uses an exact Next 16 release matched by the committed lock', () => {
  assert.match(pkg.dependencies.next, /^16\.\d+\.\d+$/);
  assert.equal(lock.packages[''].dependencies.next, pkg.dependencies.next);
  assert.equal(lock.packages['node_modules/next'].version, pkg.dependencies.next);
});
test('production build retains Prisma generation and explicit Webpack selection', () => {
  assert.equal(pkg.scripts.build, 'npm run db:generate && next build --webpack');
});
test('Next 16 builds cannot silently lose application lint or actual-config regression', () => {
  assert.equal(pkg.scripts['lint:app'], 'eslint app components lib');
  assert.ok(pkg.scripts.prebuild.startsWith('npm run lint:app && npm run lint-compat:validate && '));
  assert.match(read('scripts/validate-lint-compat.mjs'), /scripts\/lint-return-compat\.test\.mjs/);
  assert.match(read('scripts/validate-lint-compat.mjs'), /scripts\/build-runtime-contract\.test\.mjs/);
});
test('Cloudflare build keeps both type checking and adapter support enforcement', () => {
  assert.equal(pkg.scripts['cf:build'], 'npm run typecheck && opennextjs-cloudflare build');
  assert.doesNotMatch(read('next.config.ts'), /ignoreBuildErrors\s*:\s*true/);
});
for (const file of ['.github/workflows/ui-deep-inspection.yml', '.github/workflows/platform-regression.yml']) {
  test(`${file}: browser build explicitly lints and uses the same bundler`, () => {
    const text = read(file);
    const build = text.indexOf('npx next build --webpack');
    const lint = text.indexOf('npm run lint:app');
    assert.ok(build >= 0 && lint >= 0 && lint < build);
    assert.doesNotMatch(text, /dangerouslyUseUnsupportedNextVersion|ignoreBuildErrors|--no-lint/);
  });
}
test('UI inspection also runs for dependency, lint-config and build-policy changes', () => {
  const text = read('.github/workflows/ui-deep-inspection.yml');
  for (const line of ['      - package.json', '      - package-lock.json', '      - eslint.config.mjs', '      - scripts/lint-return-compat.test.mjs', '      - scripts/validate-lint-compat.mjs', '      - scripts/build-runtime-contract.test.mjs']) {
    assert.ok(text.split('\n').includes(line), `Missing trigger ${line}`);
  }
});
test('the official compatibility utility is pinned without removing the audited lint rules', () => {
  assert.equal(pkg.devDependencies['@eslint/compat'], '2.1.1');
  assert.equal(lock.packages['node_modules/@eslint/compat'].version, '2.1.1');
  assert.match(read('eslint.config.mjs'), /fixupConfigRules\(compat\.extends\("next\/core-web-vitals", "next\/typescript"\)\)/);
});
