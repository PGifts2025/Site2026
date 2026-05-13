/**
 * GET /api/proxy-image — re-serve third-party supplier images with CORS
 * headers so Fabric can draw them onto a canvas without tainting it.
 *
 * Background: Laltex's image CDN (laltex-extranet.co.uk) does NOT return
 * Access-Control-Allow-Origin. When Fabric drew those images directly, the
 * canvas became tainted and canvas.toDataURL() threw SecurityError on
 * PNG/PDF export. This endpoint fetches server-side and re-serves the
 * exact bytes with `Access-Control-Allow-Origin: *`, un-tainting Fabric's
 * canvas at the cost of one extra hop (cached at the edge).
 *
 * Hard rules:
 *   - GET only. No POST/PUT/etc.
 *   - HTTPS upstream only.
 *   - Host allowlist enforced (see ALLOWED_HOSTS below).
 *   - No client headers forwarded upstream. No cookies in either direction.
 *
 * Documented in CLAUDE.md §39.
 */

// Allowlisted upstream hosts. Adding a new supplier requires a code
// change — this Set is the review checkpoint that keeps the endpoint
// from being abused as an open proxy / SSRF surface.
const ALLOWED_HOSTS = new Set([
  'laltex-extranet.co.uk',
]);

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10MB defensive cap

export const config = {
  maxDuration: 15,
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawUrl = req.query?.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid url parameter' });
  }

  let upstreamUrl;
  try {
    upstreamUrl = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: 'Malformed URL' });
  }

  if (upstreamUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only HTTPS upstream URLs allowed' });
  }

  if (upstreamUrl.username || upstreamUrl.password) {
    return res.status(400).json({ error: 'URLs with embedded credentials are not allowed' });
  }

  if (!ALLOWED_HOSTS.has(upstreamUrl.hostname.toLowerCase())) {
    return res.status(403).json({ error: 'Upstream host not allowed' });
  }

  let upstream;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'PromoGifts-ImageProxy/1.0',
        Accept: 'image/*',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
  } catch (err) {
    console.error('[proxy-image] upstream fetch failed:', err?.message ?? err);
    return res.status(502).json({ error: 'Upstream fetch failed' });
  }

  if (!upstream.ok) {
    const status = upstream.status === 404 ? 404 : 502;
    return res.status(status).json({
      error: `Upstream returned ${upstream.status}`,
    });
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  if (!contentType.startsWith('image/')) {
    return res.status(415).json({ error: 'Upstream did not return an image' });
  }

  const arrayBuffer = await upstream.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_RESPONSE_BYTES) {
    return res.status(502).json({ error: 'Upstream response exceeds size limit' });
  }
  const buffer = Buffer.from(arrayBuffer);

  res.setHeader('Content-Type', contentType);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, immutable');
  res.setHeader('Content-Length', buffer.length.toString());
  res.setHeader('X-Proxy-Upstream-Host', upstreamUrl.hostname);

  return res.status(200).send(buffer);
}
