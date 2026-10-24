import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, lstat, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRetryTestBindings } from './notification-retry-fixture.mjs';
const tenant = 'qaretry123456abcdef';
const env = { HRBP_DISPOSABLE_AUDIT: 'true', DATABASE_URL: 'postgresql://fixture@localhost/hrbp_audit' };
async function temporary(fn) { const dir = await mkdtemp(join(tmpdir(), 'hrbp-retry-')); try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); } }
test('fixture binding explicitly selects only the synthetic tenant and is cleaned idempotently', () => temporary(async dir => {
  const clean = await createRetryTestBindings(dir, tenant, env);
  const value = await readFile(join(dir, '.dev.vars'), 'utf8');
  assert.equal(value, `HRBP_AUTH_TENANT_ID="${tenant}"\nHRBP_LOCAL_AUTH_ENABLED="true"\nHRBP_SMTP_ENABLED="false"\n`);
  assert.equal((await lstat(join(dir, '.dev.vars'))).mode & 0o777, 0o600);
  await clean(); await clean(); await assert.rejects(readFile(join(dir, '.dev.vars')), { code: 'ENOENT' });
}));
test('fixture binding refuses an existing developer file without changing its bytes', () => temporary(async dir => {
  const file = join(dir, '.dev.vars'); await writeFile(file, 'EXISTING=do-not-change');
  await assert.rejects(createRetryTestBindings(dir, tenant, env), { code: 'EEXIST' });
  assert.equal(await readFile(file, 'utf8'), 'EXISTING=do-not-change');
}));
test('fixture binding refuses a pre-existing symlink without touching its target', () => temporary(async dir => {
  const target = join(dir, 'original'); await writeFile(target, 'original'); await symlink(target, join(dir, '.dev.vars'));
  await assert.rejects(createRetryTestBindings(dir, tenant, env), { code: 'EEXIST' });
  assert.equal(await readFile(target, 'utf8'), 'original');
}));
test('fixture cleanup preserves a file changed by another writer', () => temporary(async dir => {
  const clean = await createRetryTestBindings(dir, tenant, env); await writeFile(join(dir, '.dev.vars'), 'NEW=preserve');
  await assert.rejects(clean(), /RETRY_FIXTURE_BINDINGS_CHANGED/);
  assert.equal(await readFile(join(dir, '.dev.vars'), 'utf8'), 'NEW=preserve');
}));
test('fixture cleanup preserves a pathname replaced after lease creation', () => temporary(async dir => {
  const file = join(dir, '.dev.vars');
  const clean = await createRetryTestBindings(dir, tenant, env);
  await unlink(file);
  await writeFile(file, 'REPLACED=preserve');
  await assert.rejects(clean(), /RETRY_FIXTURE_BINDINGS_CHANGED/);
  assert.equal(await readFile(file, 'utf8'), 'REPLACED=preserve');
}));
test('fixture binding rejects production database, missing opt-in and non-synthetic tenants before writing', () => temporary(async dir => {
  for (const [id, vars] of [[tenant, {}], [tenant, { ...env, DATABASE_URL: 'postgresql://fixture@db.example.test/hrbp_audit' }],
    [tenant, { ...env, DATABASE_URL: 'postgresql://fixture@localhost/hrbp' }], ['tenant-acme-global', env]]) {
    await assert.rejects(createRetryTestBindings(dir, id, vars), /RETRY_FIXTURE_NOT_DISPOSABLE/);
  }
  await assert.rejects(readFile(join(dir, '.dev.vars')), { code: 'ENOENT' });
}));
