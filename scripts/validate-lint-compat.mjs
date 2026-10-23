/** Keep security rollback scoped to tooling, with the actual config and rules still enforced. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ESLint } from 'eslint';
const require = createRequire(import.meta.url);
const configRequire = createRequire(require.resolve('eslint-config-next/package.json'));
const plugin = configRequire('@next/eslint-plugin-next');
const errors = ['inline-script-id','no-assign-module-variable','no-document-import-in-page','no-duplicate-head','no-head-import-in-document','no-script-component-in-head'];
const warnings = ['google-font-display','google-font-preconnect','next-script-for-ga','no-async-client-component','no-before-interactive-script-outside-document','no-css-tags','no-head-element','no-html-link-for-pages','no-img-element','no-page-custom-font','no-styled-jsx-in-document','no-sync-scripts','no-title-in-document-head','no-typos','no-unwanted-polyfillio'];
assert.deepEqual(Object.keys(plugin.rules).sort(), [...errors,...warnings].sort());
assert.match(require('next/package.json').version,/^16\./,'Do not downgrade the application to remove a tooling dependency.');
assert.match(require('eslint-config-next/package.json').version,/^15\./,'Keep React/TypeScript configuration on the existing major.');
const actual = await new ESLint().calculateConfigForFile('components/session-indicator.tsx');
for (const name of [...errors,...warnings]) {
  const key = '@next/next/'+name;
  const expected = errors.includes(name)||['no-html-link-for-pages','no-sync-scripts'].includes(name)?2:1;
  assert.equal(actual.rules[key][0],expected,`${key} severity must not be weakened`);
}
assert.ok(actual.plugins.react&&actual.plugins['@typescript-eslint'],'Existing React and TypeScript plugins must remain loaded.');
const engine = new ESLint({overrideConfigFile:true,overrideConfig:[{files:['**/*.jsx'],languageOptions:{ecmaVersion:'latest',sourceType:'module',parserOptions:{ecmaFeatures:{jsx:true}}},plugins:{'@next/next':plugin},rules:{...plugin.configs.recommended.rules,...plugin.configs['core-web-vitals'].rules}}]});
for (const [rule,code] of [
 ['no-assign-module-variable','let module = {};'],
 ['no-img-element','const Example = () => <img src="/test.png" alt="Test" />;'],
 ['no-sync-scripts','const Example = () => <script src="/test.js" />;']
]) {
 const [result]=await engine.lintText(code,{filePath:'app/lint-compat-fixture.jsx'});
 assert.ok(result.messages.some(x=>x.ruleId==='@next/next/'+rule),`${rule} must execute and reject its fixture`);
 assert.ok(!result.messages.some(x=>x.fatal), 'The fixture must parse successfully.');
}
const regressions = spawnSync(process.execPath, ['--test', 'scripts/lint-return-compat.test.mjs', 'scripts/build-runtime-contract.test.mjs'], { stdio: 'inherit' });
assert.ifError(regressions.error);
assert.equal(regressions.status, 0, 'The actual configured return-visitor regressions must pass.');
console.log('Lint compatibility: all 21 rule severities, original behavior fixtures and actual-config and build-policy regressions verified.');
