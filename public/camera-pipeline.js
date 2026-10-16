// Shared, testable camera scheduling and response ordering. No DOM dependencies.
(function (root) {
  'use strict';
  class Requests {
    constructor(context) { this.context = context; this.seq = 0; this.applied = 0; this.active = new Set(); }
    async run(send) {
      const context = this.context(), seq = ++this.seq, controller = new AbortController();
      this.active.add(controller);
      try {
        const result = await send(controller.signal);
        if (controller.signal.aborted || context !== this.context() || seq < this.applied) {
          throw new DOMException('Obsolete camera reading', 'AbortError');
        }
        this.applied = seq;
        return result;
      } catch (e) {
        if (controller.signal.aborted || context !== this.context() || seq < this.applied) {
          throw new DOMException('Obsolete camera reading', 'AbortError');
        }
        throw e;
      } finally { this.active.delete(controller); }
    }
    cancel() { for (const c of this.active) c.abort(); this.active.clear(); }
  }
  function shouldRead({ inflight, changed, confirming, lastSent, now, interval = 500, recovery = 3000 }) {
    return inflight === 0 && now - lastSent >= interval && (changed || confirming || now - lastSent >= recovery);
  }
  // Confirm hero and board independently, so a blurry card does not block other inputs.
  function stableCards(history, reading) {
    const result = { hero: null, board: null };
    for (const field of ['hero', 'board']) {
      const cards = reading[field], key = reading[field + 'Complete'] && Array.isArray(cards) ? cards.join(',') : null;
      const values = history[field] || (history[field] = []);
      values.push(key); if (values.length > 3) values.shift();
      if (key !== null && values.length === 3 && values.every(x => x === key)) result[field] = cards;
    }
    return result.hero || result.board ? result : null;
  }
  const api = { Requests, shouldRead, stableCards };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CameraPipeline = api;
})(typeof self !== 'undefined' ? self : this);
