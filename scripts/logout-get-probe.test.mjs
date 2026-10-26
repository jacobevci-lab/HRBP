import test from 'node:test';
import assert from 'node:assert/strict';
import { probeLogoutGet } from './logout-get-probe.mjs';
const rejected = () => new Response(null, { status: 405, headers: { allow: 'POST' } });
const redirect = (location, extra = {}) => new Response(null, { status: 307, headers: { location, ...extra } });
async function probe(responses) {
  const calls = [];
  const result = await probeLogoutGet(async (...args) => { calls.push(args); return responses.shift(); }, 'http://localhost:3100', 'signed-cookie');
  return { ...result, calls };
}
test('plain GET and a single Next RSC normalization both reach 405 without a cookie write', async () => {
  const result = await probe([rejected(), redirect('/api/auth/logout?_rsc=actual-hash'), rejected()]);
  assert.equal(result.passed, true); assert.equal(result.calls.length, 3);
  assert.deepEqual(result.calls[2], ['/api/auth/logout?_rsc=actual-hash', 'GET', 'signed-cookie', undefined, { 'next-router-prefetch': '1', rsc: '1' }]);
});
test('direct method rejection needs no redirect', async () => {
  assert.equal((await probe([rejected(), rejected()])).passed, true);
});
for (const target of ['https://other.invalid/api/auth/logout?_rsc=x', '/auth/sign-in?_rsc=x', '/api/auth/logout?other=x', '/api/auth/logout?_rsc=x&other=x']) {
  test('unsafe normalization is rejected without forwarding cookie: ' + target, async () => {
    const r = await probe([rejected(), redirect(target)]); assert.equal(r.passed, false); assert.equal(r.calls.length, 2);
  });
}
test('normalization cannot clear a cookie or loop', async () => {
  const r = await probe([rejected(), redirect('/api/auth/logout?_rsc=x', { 'set-cookie': 'session=; Max-Age=0' })]);
  assert.equal(r.passed, false); assert.equal(r.calls.length, 2);
  assert.equal((await probe([rejected(), redirect('/api/auth/logout?_rsc=x'), redirect('/api/auth/logout?_rsc=y')])).passed, false);
});
test('a successful GET is not mistaken for side-effect-free method rejection', async () => {
  assert.equal((await probe([rejected(), new Response(null, { status: 200 })])).passed, false);
});
