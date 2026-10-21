/** Capture the browser's actual fetch response before Chromium can evict its
 * DevTools body. No request replay, interception, response replacement or retry. */
export function installJsonObserver({ url, method }) {
  const original = window.fetch;
  const state = { matches: 0, done: false };
  window.__hrbpJsonObservation = state;
  window.__hrbpRestoreJsonObserver = () => { window.fetch = original; };
  window.fetch = function (...args) {
    const [input, init] = args;
    const requestUrl = new URL(input instanceof Request ? input.url : String(input), location.href).href;
    const requestMethod = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const result = original.apply(this, args);
    if (requestUrl === url && requestMethod === method) {
      state.matches++;
      void result.then(response => {
        state.status = response.status;
        return response.clone().text();
      }).then(text => { state.body = text; state.done = true; }, () => {
        state.error = 'Actual browser response could not be observed'; state.done = true;
      });
    }
    return result;
  };
}

export async function observeJsonSubmission(page, url, submit) {
  await page.evaluate(installJsonObserver, { url, method: 'POST' });
  try {
    await submit();
    await page.waitForFunction(() => window.__hrbpJsonObservation?.done, undefined, { timeout: 12000 });
    const result = await page.evaluate(() => window.__hrbpJsonObservation);
    if (result.error || result.matches !== 1) throw new Error(result.error || 'Expected exactly one browser submission');
    return { status: result.status, body: JSON.parse(result.body) };
  } finally {
    await page.evaluate(() => {
      window.__hrbpRestoreJsonObserver?.();
      delete window.__hrbpRestoreJsonObserver;
      delete window.__hrbpJsonObservation;
    });
  }
}
