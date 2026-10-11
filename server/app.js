'use strict';
// Builds the request handler: security headers, HTTPS redirect, routing, access code + rate limit on
// metered (OpenAI-backed) routes, static files from public/, and JSON errors.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { HttpError, sendJson, clientIp } = require('./http');
const { createRateLimiter } = require('./rateLimit');
const { createOpenAI } = require('./openai');
const routeModules = require('./routes');
const { createAgent } = require('./agent');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const COMPRESSIBLE = /^(text\/|application\/(json|manifest)|image\/svg)/;

const SECURITY_HEADERS = {
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "img-src 'self' data:", "media-src 'self' blob:", "connect-src 'self'",
    "frame-ancestors 'self'", "base-uri 'none'", "form-action 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function createRouter() {
  const routes = [];
  const add = method => (p, opts, handler) => { if (typeof opts === 'function') { handler = opts; opts = {}; } routes.push({ method, path: p, opts, handler }); };
  return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'),
    match(method, p) { const forPath = routes.filter(r => r.path === p); return { route: forPath.find(r => r.method === method || (method === 'HEAD' && r.method === 'GET')), allowed: forPath.map(r => r.method) }; } };
}

const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function createApp(config, { fetchImpl, log = line => console.log(JSON.stringify(line)) } = {}) {
  const openai = createOpenAI(config.openai, { fetchImpl, log });
  const limiter = createRateLimiter({ perMinute: config.rateLimitPerMin });
  const router = createRouter();
  const ctx = { config, openai, log, agent: createAgent(config, openai) };
  routeModules.forEach(register => register(router, ctx));
  const fileCache = new Map();

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'not_found', 'Not found');
    let stat; try { stat = fs.statSync(file); } catch (e) { stat = null; }
    if (!stat || !stat.isFile()) { if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); } throw new HttpError(404, 'not_found', 'Not found'); }
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    const etag = `"${stat.size.toString(36)}-${stat.mtimeMs.toString(36)}"`;
    const base = { 'Content-Type': type, ETag: etag, 'Cache-Control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=300', Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, base); return res.end(); }
    let entry = fileCache.get(file);
    if (!entry || entry.etag !== etag) { const raw = fs.readFileSync(file); entry = { etag, raw, gz: COMPRESSIBLE.test(type) ? zlib.gzipSync(raw) : null }; fileCache.set(file, entry); }
    const gz = entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const body = gz ? entry.gz : entry.raw;
    res.writeHead(200, { ...base, ...(gz ? { 'Content-Encoding': 'gzip' } : {}), 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  return async function handle(req, res) {
    const started = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    if (proto === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.on('finish', () => { if (url.pathname.startsWith('/api/')) log({ msg: 'request', method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started }); });

    try {
      if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); return res.end('ok'); }
      // Browsers only allow the microphone on secure pages; push plain HTTP behind the proxy to HTTPS.
      if (proto === 'http' && req.headers.host) { res.writeHead(308, { Location: `https://${req.headers.host}${req.url}` }); return res.end(); }

      const { route, allowed } = router.match(req.method, url.pathname);
      if (!route) {
        if (allowed.length) throw new HttpError(405, 'method_not_allowed', `Use ${allowed.join(', ')}.`);
        if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'not_found', 'No such API route.');
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Use GET.');
        return serveStatic(req, res, url.pathname);
      }
      if (route.opts.metered) {
        if (config.accessCode && !safeEqual(req.headers['x-access-code'] || '', config.accessCode)) throw new HttpError(401, 'access_code_required', 'Enter the access code to use voice features.');
        const wait = limiter.take(clientIp(req));
        if (wait) throw new HttpError(429, 'rate_limited', `Too many requests. Try again in ${wait}s.`, { retryAfter: wait });
      }
      const send = { json: (status, body) => sendJson(res, status, body), text: (status, body) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); } };
      await route.handler(req, res, { send, query: url.searchParams, ...ctx });
    } catch (err) {
      const e = err instanceof HttpError ? err : new HttpError(500, 'server_error', 'Something went wrong on the server.');
      if (!(err instanceof HttpError)) log({ msg: 'error', path: url.pathname, error: err.stack || String(err) });
      else if (e.status >= 500) log({ msg: 'upstream', path: url.pathname, code: e.code, error: e.message });
      if (res.headersSent) return res.destroy();
      const headers = e.extra && e.extra.retryAfter ? { 'Retry-After': String(e.extra.retryAfter) } : {};
      if (url.pathname.startsWith('/api/') || e.status !== 404) sendJson(res, e.status, { error: { code: e.code, message: e.message } }, headers);
      else { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); }
    }
  };
}

module.exports = { createApp };
