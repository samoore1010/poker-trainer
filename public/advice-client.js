// A dedicated worker cannot be blocked by background equity charts. Superseded jobs are terminated.
(function (root) {
  class AdviceClient {
    constructor(onResult) { this.onResult = onResult; this.key = null; this.result = null; this.worker = null; this.cache = new Map(); }
    cancel() { if (this.worker) this.worker.terminate(); this.worker = null; this.key = null; this.result = null; }
    request(payload) {
      const key = JSON.stringify(payload);
      if (key === this.key) return this.result;
      this.cancel(); this.key = key;
      if (this.cache.has(key)) { this.result = this.cache.get(key); return this.result; }
      try {
        const worker = this.worker = new Worker('advice-worker.js');
        worker.onmessage = ({ data }) => {
          if (this.worker !== worker || this.key !== data.key) return;
          worker.terminate(); this.worker = null;
          this.result = data.result || null;
          if (this.result) { if (this.cache.size >= 24) this.cache.delete(this.cache.keys().next().value); this.cache.set(key, this.result); }
          this.onResult(data.error);
        };
        worker.onerror = () => { if (this.worker === worker) { worker.terminate(); this.worker = null; this.onResult('Advice worker unavailable'); } };
        worker.postMessage({ ...payload, key });
      } catch (e) { this.onResult('Advice worker unavailable'); }
      return null;
    }
  }
  root.AdviceClient = AdviceClient;
})(typeof self !== 'undefined' ? self : this);
