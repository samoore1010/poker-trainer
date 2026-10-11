'use strict';
// In-memory sliding-window limiter keyed by visitor IP. Good for a single Railway instance;
// swap for Redis if you scale to several replicas.

function createRateLimiter({ perMinute, now = Date.now }) {
  const hits = new Map();
  const windowMs = 60 * 1000;
  const sweep = setInterval(() => { const cut = now() - windowMs; for (const [k, v] of hits) { const keep = v.filter(t => t > cut); if (keep.length) hits.set(k, keep); else hits.delete(k); } }, windowMs);
  sweep.unref();
  return {
    // Returns 0 when allowed, otherwise seconds until the next request would be allowed.
    take(key) {
      if (!perMinute || perMinute <= 0) return 0;
      const t = now(), cut = t - windowMs;
      const list = (hits.get(key) || []).filter(x => x > cut);
      if (list.length >= perMinute) { hits.set(key, list); return Math.max(1, Math.ceil((list[0] + windowMs - t) / 1000)); }
      list.push(t); hits.set(key, list); return 0;
    },
  };
}

module.exports = { createRateLimiter };
