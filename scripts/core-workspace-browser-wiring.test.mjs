import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('healthy browser gate rejects error-shell false positives and remains mandatory', () => {
  const browser = readFileSync('scripts/core-workspace-browser-regression.mjs', 'utf8');
  assert.match(browser, /data-core-workspace-state="unavailable"/);
  assert.match(browser, /report\.checks\.length, 32/);
  assert.match(browser, /session\.user\.id/);
  assert.match(browser, /report\.failures, \[\]/);
  const workflow = readFileSync('.github/workflows/platform-regression.yml', 'utf8');
  assert.match(workflow, /node scripts\/core-workspace-browser-regression\.mjs\s*node scripts\/platform-remediation-gate\.mjs/);
});
