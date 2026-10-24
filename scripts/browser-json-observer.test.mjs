import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { installJsonObserver, observeJsonSubmission } from './browser-json-observer.mjs';

test('observer copies the actual conflict response without replay or consuming the UI body', async () => {
  const url = 'http://localhost:3100/api/leave/requests';
  const body = '{"code":"LEAVE_UNIT_CHANGED"}';
  const response = new Response(body, { status: 409 });
  const originalPromise = Promise.resolve(response);
  const calls = [];
  const window = { fetch: (...args) => { calls.push(args); return originalPromise; } };
  const original = window.fetch;
  runInNewContext(`(${installJsonObserver.toString()})({url,method:'POST'})`, { window, url, Request, URL, location: { href: url } });
  const init = { method: 'POST', body: 'original-request' };
  const result = window.fetch(url, init);
  assert.equal(result, originalPromise);
  assert.equal(await result, response);
  assert.equal(await response.text(), body, 'The UI still reads the real response');
  for (let i = 0; !window.__hrbpJsonObservation.done && i < 30; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(window.__hrbpJsonObservation.status, 409);
  assert.equal(window.__hrbpJsonObservation.body, body);
  assert.equal(window.__hrbpJsonObservation.matches, 1);
  assert.deepEqual(calls, [[url, init]]);
  window.__hrbpRestoreJsonObserver(); assert.equal(window.fetch, original);
});

for (const observation of [
  { matches: 0, body: '{}' }, { matches: 2, body: '{}' },
  { matches: 1, error: 'Actual browser response could not be observed' },
  { matches: 1, body: '<html>not JSON</html>' }
]) test('missing, repeated or unreadable evidence fails closed: ' + JSON.stringify(observation), async () => {
  let restored = false, calls = 0;
  const page = { evaluate: async (_fn, arg) => {
    if (arg) return;
    if (++calls === 1) return observation;
    restored = true;
  }, waitForFunction: async () => {} };
  let submits = 0;
  await assert.rejects(observeJsonSubmission(page, '/api/leave/requests', async () => { submits++; }));
  assert.equal(submits, 1); assert.equal(restored, true);
});
