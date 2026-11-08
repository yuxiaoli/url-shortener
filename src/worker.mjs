import {SNAPSHOT_KEY, parseConfig, parseOrigin, validPath} from './config.mjs';

const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};
function reply(request, status, text, extra = {}) {
  return new Response(request.method === 'HEAD' ? null : text, {
    status, headers: {...headers, 'Content-Type': 'text/plain; charset=utf-8', ...extra},
  });
}
export default {
  async fetch(request, env) {
    if (!['GET', 'HEAD'].includes(request.method)) return reply(request, 405, 'Method not allowed.', {Allow: 'GET, HEAD'});
    const url = new URL(request.url);
    // No decoding, query-driven destination, directory listing, or management API.
    if (!validPath(url.pathname)) return reply(request, 404, 'Not found.');
    try {
      const origin = parseOrigin(env.PUBLIC_ORIGIN);
      const text = await env.LINKS.get(SNAPSHOT_KEY, 'text');
      if (text === null) return reply(request, 503, 'Service is not configured.');
      const config = parseConfig(text);
      if (config.publicOrigin !== origin.origin) return reply(request, 503, 'Service unavailable.');
      const entry = config.redirects.find(link => link.path === url.pathname);
      if (!entry) return reply(request, 404, 'Not found.');
      // Request query parameters never change or get appended to the stored target.
      return new Response(null, {status: 302, headers: {...headers, Location: entry.target}});
    } catch {
      // Do not log URLs, mappings, credentials, or provider error bodies.
      return reply(request, 503, 'Service unavailable.');
    }
  },
};
