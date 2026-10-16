// Keep an independent advice job alive across unchanged camera observations.
(function (root) {
  class AdviceClient {
    constructor(onResult, fallback) { this.onResult = onResult; this.fallback = fallback; this.key = null; this.result = null; this.worker = null; this.cache = new Map(); this.error = null; this.timer = null; }
    cancel() { if (this.worker) this.worker.terminate(); clearTimeout(this.timer); this.timer = null; this.worker = null; this.key = null; this.result = null; this.error = null; }
    request(payload) {
      const key = JSON.stringify(payload);
      if (key === this.key) return this.result;
      this.cancel(); this.key = key;
      if (this.cache.has(key)) { this.result = this.cache.get(key); return this.result; }
      const finish = (result, error) => {
        if (this.key !== key) return;
        if (this.worker) this.worker.terminate(); this.worker = null;
        clearTimeout(this.timer); this.timer = null;
        this.result = result || null; this.error = error || null;
        if (this.result) { if (this.cache.size >= 24) this.cache.delete(this.cache.keys().next().value); this.cache.set(key, this.result); }
        this.onResult(this.error);
      };
      const recover = () => {
        if (this.key !== key) return;
        if (this.worker) this.worker.terminate(); this.worker = null;
        clearTimeout(this.timer);
        // Yield before the compatibility path so the UI can paint its loading state.
        this.timer = setTimeout(() => {
          if (this.key !== key) return;
          try { if (!this.fallback) throw Error('Advice worker unavailable'); finish(this.fallback(payload)); }
          catch (e) { finish(null, 'Advice could not be calculated: ' + e.message); }
        }, 0);
      };
      try {
        const worker = this.worker = new Worker('advice-worker.js');
        worker.onmessage = ({ data }) => {
          if (this.worker !== worker || this.key !== data.key) return;
          if (data.error || !data.result) recover(); else finish(data.result);
        };
        worker.onerror = () => { if (this.worker === worker) recover(); };
        this.timer = setTimeout(recover, 20000);
        worker.postMessage({ ...payload, key });
      } catch (e) { recover(); }
      return null;
    }
  }
  root.AdviceClient = AdviceClient;
})(typeof self !== 'undefined' ? self : this);
