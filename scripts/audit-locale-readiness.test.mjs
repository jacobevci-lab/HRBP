import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { waitForAuditLocale } from './audit-locale-readiness.mjs';

function fixture({ lang = 'tr', busy = 'false', toggle = true, error = false, marker = true } = {}) {
  const calls = [];
  const document = {
    documentElement: { lang },
    querySelector(selector) {
      if (selector === '.locale-toggle') return toggle ? { getAttribute: key => key === 'aria-busy' ? busy : null } : null;
      if (selector === '.locale-error') return error ? {} : null;
      throw new Error(`Unexpected DOM query: ${selector}`);
    }
  };
  return {
    calls,
    page: {
      async waitForFunction(predicate, expected, options) {
        calls.push({ type: 'client', expected, timeout: options.timeout });
        // Execute the production predicate, not a second copy of its conditions.
        const ready = runInNewContext(`(${predicate.toString()})(expected)`, { document, expected });
        if (!ready) throw new Error('Locale readiness timeout');
      },
      locator(selector) {
        return { async waitFor(options) {
          calls.push({ type: 'server', selector, timeout: options.timeout });
          if (!marker) throw new Error('Server locale marker timeout');
        } };
      }
    }
  };
}

for (const locale of ['en', 'tr']) {
  test(`${locale}: every ordinary page requires a settled matching document locale`, async () => {
    const f = fixture({ lang: locale });
    await waitForAuditLocale(f.page, '/module/onboarding', locale);
    assert.deepEqual(f.calls, [{ type: 'client', expected: locale, timeout: 10000 }]);
  });
  for (const path of ['/module/audit', '/module/engagement', '/module/workforce-planning', '/module/ai-assistant']) {
    test(`${locale}: ${path} retains its server marker after client completion`, async () => {
      const f = fixture({ lang: locale });
      await waitForAuditLocale(f.page, path, locale);
      assert.equal(f.calls.length, 2);
      assert.equal(f.calls[0].type, 'client');
      assert.deepEqual(f.calls[1], {
        type: 'server', timeout: 10000,
        selector: path === '/module/audit'
          ? `.audit-live-page[data-audit-locale="${locale}"]`
          : `.gov-shell[data-governance-locale="${locale}"]`
      });
    });
  }
}
for (const [name, options] of [
  ['old language', { lang: 'en' }],
  ['pending transition', { busy: 'true' }],
  ['missing readiness attribute', { busy: null }],
  ['missing toggle', { toggle: false }],
  ['visible locale failure', { error: true }]
]) {
  test(`${name} cannot be reported as a completed Turkish selection`, async () => {
    const f = fixture(options);
    await assert.rejects(waitForAuditLocale(f.page, '/module/documents', 'tr'), /Locale readiness timeout/);
    assert.equal(f.calls.length, 1, 'No retry or secondary probe may conceal failure');
  });
}
test('client completion cannot substitute for the existing server locale assertion', async () => {
  const f = fixture({ marker: false });
  await assert.rejects(waitForAuditLocale(f.page, '/module/audit', 'tr'), /Server locale marker timeout/);
  assert.equal(f.calls.length, 2);
});
for (const locale of ['', 'TR', 'de', null, undefined]) {
  test(`invalid locale ${String(locale)} is rejected before browser access`, async () => {
    await assert.rejects(waitForAuditLocale({}, '/module/people', locale), TypeError);
  });
}
for (const path of [null, 'https://other.invalid', '//other.invalid', 'module/people']) {
  test(`invalid application path ${String(path)} is rejected before browser access`, async () => {
    await assert.rejects(waitForAuditLocale({}, path, 'tr'), TypeError);
  });
}

test('the actual browser sweep delegates both locale changes and records English state', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./platform-auth-browser-audit.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{ waitForAuditLocale as waitServerLocale \} from '\.\/audit-locale-readiness\.mjs'/);
  assert.ok(!source.includes('async function waitServerLocale('), 'No shadowing by the old incomplete helper');
  for (const locale of ['tr', 'en']) assert.ok(source.includes(`await waitServerLocale(page,path,'${locale}')`));
  assert.ok(source.includes("const englishSelected=await page.evaluate(()=>document.documentElement.lang==='en')"));
  assert.ok(source.includes('turkishSelected:tr.selected,englishSelected'));
  assert.ok(source.includes('status:0,principalVerified:false,error:'), 'Readiness failure remains a failed audit row');
});

test('readiness tests and existing fail-closed browser stages remain mandatory', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../.github/workflows/platform-regression.yml', import.meta.url), 'utf8');
  const tests = source.split('\n').find(line => line.includes('node --test scripts/platform-remediation.test.mjs'));
  assert.ok(tests.includes('scripts/audit-locale-readiness.test.mjs'));
  for (const name of ['platform-render', 'locale-preference', 'locale-progress', 'core-workspace-resilience', 'core-workspace-browser-wiring', 'module-workspace-resilience', 'leave-validation', 'leave-client-action', 'leave-decision', 'action-center-leave', 'action-center-queue', 'action-center-source-health']) {
    assert.ok(tests.includes(`scripts/${name}.test.mjs`));
  }
  for (const name of ['platform-auth-browser-audit', 'action-center-source-health-browser', 'leave-decision-browser-regression', 'leave-api-regression', 'leave-browser-regression', 'module-workspace-browser-regression', 'core-workspace-browser-regression', 'platform-remediation-gate']) {
    assert.ok(source.includes(`node scripts/${name}.mjs`));
  }
  assert.ok(!source.includes('continue-on-error: true'));
});
