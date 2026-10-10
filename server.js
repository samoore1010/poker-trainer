// Minimal production server for Railway (or any Node host). No dependencies.
// Serves index.html over the host's HTTPS with headers that let the page use the microphone.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const page = fs.readFileSync(path.join(__dirname, 'index.html'));
const pageGz = zlib.gzipSync(page);
const etag = '"' + crypto.createHash('sha1').update(page).digest('hex').slice(0, 16) + '"';

const SECURITY_HEADERS = {
  // Speech recognition needs the microphone; allow it for this origin only.
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();

  if (url.pathname === '/health') return send(res, 200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }, 'ok');

  // Browsers only allow the microphone on secure pages, so push plain HTTP behind the proxy to HTTPS.
  if (proto === 'http' && req.headers.host) {
    return send(res, 308, { Location: `https://${req.headers.host}${req.url}` }, '');
  }
  const hsts = proto === 'https' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {};

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { Allow: 'GET, HEAD', ...hsts }, '');
  if (url.pathname === '/favicon.ico') return send(res, 204, { 'Cache-Control': 'public, max-age=86400', ...hsts }, '');
  if (url.pathname !== '/' && url.pathname !== '/index.html') return send(res, 404, { 'Content-Type': 'text/plain', ...hsts }, 'Not found');

  const base = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag, Vary: 'Accept-Encoding', ...hsts };
  if (req.headers['if-none-match'] === etag) return send(res, 304, base, '');
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = gz ? pageGz : page;
  send(res, 200, { ...base, ...(gz ? { 'Content-Encoding': 'gzip' } : {}), 'Content-Length': body.length }, req.method === 'HEAD' ? '' : body);
});

server.listen(PORT, HOST, () => console.log(`Hand Walkthrough listening on http://${HOST}:${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
