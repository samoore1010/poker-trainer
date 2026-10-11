'use strict';
// Small request/response helpers shared by every route.

class HttpError extends Error {
  // code is a stable machine-readable string the client switches on; message is for people.
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

function sendJson(res, status, body, headers = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) { req.resume(); return reject(new HttpError(413, 'too_large', `Request is larger than ${Math.round(limit / 1048576)} MB.`)); }
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { req.destroy(); reject(new HttpError(413, 'too_large', `Request is larger than ${Math.round(limit / 1048576)} MB.`)); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 64 * 1024) {
  if (!/application\/json/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'bad_content_type', 'Send JSON with Content-Type: application/json.');
  const buf = await readBody(req, limit);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch (e) { throw new HttpError(400, 'bad_json', 'Request body is not valid JSON.'); }
}

function clientIp(req) {
  // Railway's proxy puts the visitor first in X-Forwarded-For.
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

module.exports = { HttpError, sendJson, readBody, readJson, clientIp };
