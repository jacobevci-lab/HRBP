/** Next 16 validates the RSC cache key before invoking an API route. Keep that
 * protection enabled and verify every hop, including the final method rejection. */
export async function probeLogoutGet(http, origin, cookie) {
  const path = '/api/auth/logout';
  const requests = [];
  const read = async (target, headers = {}) => {
    const response = await http(target, 'GET', cookie, undefined, headers);
    const record = { status: response.status, location: response.headers.get('location'),
      setsCookie: response.headers.has('set-cookie'), allow: response.headers.get('allow') };
    requests.push(record);
    return record;
  };
  const plain = await read(path);
  const headers = { 'next-router-prefetch': '1', rsc: '1' };
  let prefetch = await read(path, headers);
  if (prefetch.status === 307 && !prefetch.setsCookie && prefetch.location) {
    const target = new URL(prefetch.location, origin);
    // Never forward the signed cookie to another origin, route, or arbitrary query.
    if (target.origin !== origin || target.pathname !== path || target.hash ||
        !target.searchParams.get('_rsc') || [...target.searchParams.keys()].some(key => key !== '_rsc')) {
      return { passed: false, requests };
    }
    prefetch = await read(target.pathname + target.search, headers);
  }
  return { passed: plain.status === 405 && plain.allow === 'POST' &&
    prefetch.status === 405 && prefetch.allow === 'POST' && requests.every(r => !r.setsCookie), requests };
}
