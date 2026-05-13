/**
 * Smoke test for api/proxy-image.js — exercises every validation
 * branch with mock req/res, plus one real upstream fetch.
 *
 * Run: node scripts/smoke-test-proxy-image.js
 *
 * Hits the real Laltex CDN for the happy-path case. No DB / secrets.
 */

import handler from '../api/proxy-image.js';

function mockReqRes({ method = 'GET', url = '' } = {}) {
  const u = new URL(`http://test${url}`);
  const query = Object.fromEntries(u.searchParams.entries());

  const headers = {};
  let body = null;
  let statusCode = 200;

  const res = {
    setHeader(k, v) { headers[k] = v; },
    status(code) { statusCode = code; return res; },
    json(payload) { body = payload; return res; },
    send(payload) { body = payload; return res; },
  };

  return {
    req: { method, url, query },
    res,
    headersRef: headers,
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
}

async function run(name, opts, assertion) {
  const ctx = mockReqRes(opts);
  await handler(ctx.req, ctx.res);
  const result = {
    status: ctx.statusCode,
    contentType: ctx.headersRef['Content-Type'],
    cors: ctx.headersRef['Access-Control-Allow-Origin'],
    cache: ctx.headersRef['Cache-Control'],
    body: ctx.body,
    bodyType: Buffer.isBuffer(ctx.body) ? `Buffer(${ctx.body.length})` : typeof ctx.body,
  };
  const ok = assertion(result);
  const tag = ok ? 'PASS' : 'FAIL';
  const printable = { ...result, body: Buffer.isBuffer(result.body) ? `<bytes:${result.body.length}>` : result.body };
  console.log(`[${tag}] ${name} → ${JSON.stringify(printable)}`);
  return ok;
}

const results = [];

results.push(
  await run(
    'POST returns 405',
    { method: 'POST', url: '/api/proxy-image?url=https://laltex-extranet.co.uk/foo.jpg' },
    (r) => r.status === 405 && r.body.error === 'Method not allowed',
  ),
);

results.push(
  await run(
    'missing url param returns 400',
    { method: 'GET', url: '/api/proxy-image' },
    (r) => r.status === 400,
  ),
);

results.push(
  await run(
    'malformed url returns 400',
    { method: 'GET', url: '/api/proxy-image?url=not-a-url' },
    (r) => r.status === 400 && r.body.error === 'Malformed URL',
  ),
);

results.push(
  await run(
    'http upstream returns 400',
    { method: 'GET', url: '/api/proxy-image?url=http%3A%2F%2Flaltex-extranet.co.uk%2Ffoo.jpg' },
    (r) => r.status === 400 && /HTTPS/.test(r.body.error),
  ),
);

results.push(
  await run(
    'embedded credentials returns 400',
    {
      method: 'GET',
      url: '/api/proxy-image?url=' + encodeURIComponent('https://user:pass@laltex-extranet.co.uk/foo.jpg'),
    },
    (r) => r.status === 400 && /credentials/.test(r.body.error),
  ),
);

results.push(
  await run(
    'non-allowlisted host returns 403',
    { method: 'GET', url: '/api/proxy-image?url=' + encodeURIComponent('https://example.com/foo.jpg') },
    (r) => r.status === 403 && r.body.error === 'Upstream host not allowed',
  ),
);

results.push(
  await run(
    'host case-insensitive (UPPER allowed)',
    {
      method: 'GET',
      url: '/api/proxy-image?url=' + encodeURIComponent('https://LALTEX-EXTRANET.CO.UK/images/MG0192AM.jpg'),
    },
    (r) => r.status === 200 && r.cors === '*' && r.bodyType.startsWith('Buffer('),
  ),
);

results.push(
  await run(
    'happy path returns image bytes with CORS + cache headers',
    {
      method: 'GET',
      url:
        '/api/proxy-image?url=' +
        encodeURIComponent('https://laltex-extranet.co.uk/images/pac/MG0192 AM Print.jpg'),
    },
    (r) =>
      r.status === 200 &&
      r.cors === '*' &&
      r.contentType?.startsWith('image/') &&
      r.cache?.includes('s-maxage=86400') &&
      r.bodyType.startsWith('Buffer('),
  ),
);

results.push(
  await run(
    'allowlisted host but missing image returns 404',
    {
      method: 'GET',
      url:
        '/api/proxy-image?url=' +
        encodeURIComponent('https://laltex-extranet.co.uk/this-does-not-exist-9999.jpg'),
    },
    (r) => r.status === 404 || r.status === 502, // some CDNs 200 a placeholder; either is acceptable
  ),
);

const passed = results.filter(Boolean).length;
const total = results.length;
console.log(`\n${passed}/${total} smoke tests passed`);
process.exit(passed === total ? 0 : 1);
