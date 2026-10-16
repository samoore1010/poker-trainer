// Browser side of the voice API: a microphone recorder with a level meter and silence detection,
// and a small client for the server's /api routes. Exposed as window.HandVoice for the app (and future features).
(function () {
  'use strict';

  class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

  // ----- API client -----
  const CODE_KEY = 'walkthrough.accessCode';
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} } };

  const api = {
    status: null,
    // Reads /api/status once. Resolves null when there is no server (page opened from disk) or it is unreachable.
    async init() {
      if (!/^https?:$/.test(location.protocol)) return null;
      try { const r = await fetch('/api/status', { cache: 'no-store' }); if (r.ok) this.status = await r.json(); } catch (e) {}
      return this.status;
    },
    has(feature) { return !!(this.status && this.status.features && this.status.features[feature]); },

    async request(path, { method = 'POST', body, headers = {}, as = 'json', signal, retried = false } = {}) {
      const code = store.get(CODE_KEY);
      let res;
      try { res = await fetch(path, { method, body, signal, headers: { ...headers, ...(code ? { 'X-Access-Code': code } : {}) } }); }
      catch (e) { if (e.name === 'AbortError') throw e; throw new ApiError(0, 'offline', 'Could not reach the server. Check your connection.'); }
      if (res.ok) return as === 'blob' ? res.blob() : res.json();
      let err = { code: 'http_' + res.status, message: `Server error ${res.status}` };
      try { err = (await res.json()).error || err; } catch (e) {}
      if (err.code === 'access_code_required' && !retried) {
        const entered = window.prompt(code ? 'That access code did not work. Enter the access code:' : 'Enter the access code for voice features:');
        if (entered) { store.set(CODE_KEY, entered.trim()); return this.request(path, { method, body, headers, as, signal, retried: true }); }
        store.set(CODE_KEY, null);
      }
      throw new ApiError(res.status, err.code, err.message);
    },
    // POST JSON and read an NDJSON stream; onEvent gets each event. Resolves with the final {type:'done'} event.
    async stream(path, payload, onEvent, retried = false) {
      const code = store.get(CODE_KEY);
      let res;
      try { res = await fetch(path, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', ...(code ? { 'X-Access-Code': code } : {}) } }); }
      catch (e) { if (e.name === 'AbortError') throw e; throw new ApiError(0, 'offline', 'Could not reach the server. Check your connection.'); }
      if (!res.ok) {
        let err = { code: 'http_' + res.status, message: `Server error ${res.status}` };
        try { err = (await res.json()).error || err; } catch (e) {}
        if (err.code === 'access_code_required' && !retried) {
          const entered = window.prompt(code ? 'That access code did not work. Enter the access code:' : 'Enter the access code:');
          if (entered) { store.set(CODE_KEY, entered.trim()); return this.stream(path, payload, onEvent, true); }
          store.set(CODE_KEY, null);
        }
        throw new ApiError(res.status, err.code, err.message);
      }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '', done = null;
      const handle = line => {
        if (!line.trim()) return;
        let ev; try { ev = JSON.parse(line); } catch (e) { return; }
        if (ev.type === 'error') throw new ApiError(502, ev.code, ev.message);
        if (ev.type === 'done') done = ev; else onEvent(ev);
      };
      for (;;) {
        const { value, done: end } = await reader.read();
        if (value) { buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop(); lines.forEach(handle); }
        if (end) break;
      }
      handle(buf);
      if (!done) throw new ApiError(0, 'incomplete', 'The connection closed before the coach finished. Try again.');
      return done;
    },
    transcribe(blob, { context = 'cards', lang = 'en' } = {}) {
      return this.request(`/api/transcribe?context=${encodeURIComponent(context)}&lang=${encodeURIComponent(lang)}`, { body: blob, headers: { 'Content-Type': blob.type || 'audio/webm' } });
    },
    parseCards(text) { return this.request('/api/cards/parse', { body: JSON.stringify({ text }), headers: { 'Content-Type': 'application/json' } }); },
    speak(text, voice) { return this.request('/api/speak', { body: JSON.stringify(voice ? { text, voice } : { text }), headers: { 'Content-Type': 'application/json' }, as: 'blob' }); },
  };

  // ----- recorder -----
  const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
  const pickMime = () => (window.MediaRecorder && MediaRecorder.isTypeSupported ? MIMES.find(m => MediaRecorder.isTypeSupported(m)) : '') || '';
  const supported = () => !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);

  const MIC_ERRORS = {
    NotAllowedError: ['mic_denied', 'Microphone access is blocked. Click the lock or site-settings icon in the address bar, allow Microphone, then try again.'],
    SecurityError: ['mic_denied', 'This page is not allowed to use the microphone. Open it in its own tab over https.'],
    NotFoundError: ['mic_missing', 'No microphone was found. Plug one in or choose an input in your system sound settings.'],
    OverconstrainedError: ['mic_missing', 'No usable microphone was found.'],
    NotReadableError: ['mic_busy', 'The microphone is in use by another app or could not start. Close other apps using it and try again.'],
    AbortError: ['mic_busy', 'The microphone could not start. Try again.'],
  };

  // Records until stop(), a pause after speech, or the time limit. Calls onLevel(0..1) every frame.
  // done resolves {blob, mime, ms, device} or rejects ApiError: mic_* codes, 'mic_silent' (the mic delivers no sound), 'no_speech'.
  class Recorder {
    constructor({ onLevel = () => {}, onSpeech = () => {}, silenceMs = 1600, maxMs = 30000, waitMs = 8000 } = {}) {
      Object.assign(this, { onLevel, onSpeech, silenceMs, maxMs, waitMs });
      this.done = new Promise((res, rej) => { this._resolve = res; this._reject = rej; });
      this.done.catch(() => {});
      this.state = 'idle';
    }
    async start() {
      if (!supported()) throw new ApiError(0, 'mic_unsupported', window.isSecureContext ? 'This browser cannot record audio.' : 'Recording needs an https:// page.');
      this.state = 'starting';
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = AC ? new AC() : null; // created inside the click so Safari lets it run
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      } catch (e) {
        this._cleanup();
        const [code, msg] = MIC_ERRORS[e.name] || ['mic_error', 'Microphone error: ' + (e.message || e.name)];
        throw new ApiError(0, code, msg);
      }
      if (this.state === 'cancelled') { this._cleanup(); throw new ApiError(0, 'cancelled', 'Cancelled'); }
      const track = this.stream.getAudioTracks()[0];
      this.device = track ? track.label : '';
      if (track) track.onended = () => this.stop();
      const mime = pickMime();
      this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
      this.chunks = [];
      this.rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.rec.onstop = () => this._finish();
      this.rec.start(250);
      this.t0 = performance.now(); this.state = 'recording';
      this.peak = 0; this.spoke = false; this.lastLoud = 0; this.floor = null;
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        const src = this.ctx.createMediaStreamSource(this.stream);
        this.an = this.ctx.createAnalyser(); this.an.fftSize = 1024; src.connect(this.an);
        this.buf = new Float32Array(this.an.fftSize);
      }
      this._tick();
      return this;
    }
    _tick() {
      if (this.state !== 'recording') return;
      const t = performance.now() - this.t0;
      if (this.an) {
        this.an.getFloatTimeDomainData(this.buf);
        let sum = 0; for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
        const rms = Math.sqrt(sum / this.buf.length);
        this.peak = Math.max(this.peak, rms);
        if (t < 400) this.floor = this.floor == null ? rms : Math.min(this.floor, rms); // room noise while the user starts talking
        const loud = rms > Math.max(0.015, (this.floor || 0) * 3);
        if (loud) { if (!this.spoke) { this.spoke = true; this.onSpeech(); } this.lastLoud = t; }
        this.onLevel(Math.min(1, rms * 8));
        if (this.spoke && t - this.lastLoud > this.silenceMs) return this.stop();
        if (!this.spoke && t > this.waitMs) { this.reason = this.peak < 0.003 ? 'mic_silent' : 'no_speech'; return this.stop(); }
      }
      if (t > this.maxMs) return this.stop();
      this.raf = requestAnimationFrame(() => this._tick());
    }
    stop() { if (this.state === 'recording') { this.state = 'stopping'; try { this.rec.stop(); } catch (e) { this._finish(); } } else if (this.state === 'starting') this.cancel(); }
    cancel() { const was = this.state; this.state = 'cancelled'; if (was === 'recording') { try { this.rec.onstop = null; this.rec.stop(); } catch (e) {} } this._cleanup(); this._reject(new ApiError(0, 'cancelled', 'Cancelled')); }
    _finish() {
      const ms = Math.round(performance.now() - this.t0), mime = (this.rec && this.rec.mimeType) || pickMime() || 'audio/webm';
      this._cleanup(); this.state = 'done';
      if (this.reason === 'mic_silent') return this._reject(new ApiError(0, 'mic_silent', `Your microphone${this.device ? ` (${this.device})` : ''} is sending no sound. Check that it isn't muted and that the right input is selected in your system sound settings.`));
      if (this.reason === 'no_speech') return this._reject(new ApiError(0, 'no_speech', 'No speech heard. Click the mic and say your cards.'));
      const blob = new Blob(this.chunks, { type: mime.split(';')[0] });
      if (blob.size < 1000) return this._reject(new ApiError(0, 'no_speech', 'The recording was too short. Click the mic and say your cards.'));
      this._resolve({ blob, mime, ms, device: this.device });
    }
    _cleanup() {
      cancelAnimationFrame(this.raf); this.onLevel(0);
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      if (this.ctx && this.ctx.state !== 'closed') this.ctx.close().catch(() => {});
      this.stream = null; this.ctx = null; this.an = null;
    }
  }

  // Plays text through /api/speak. Returns a stop() function.
  let current = null;
  async function speak(text, voice) {
    if (current) current();
    const blob = await api.speak(text, voice);
    const url = URL.createObjectURL(blob), audio = new Audio(url);
    const stop = () => { audio.pause(); URL.revokeObjectURL(url); if (current === stop) current = null; };
    audio.onended = stop; current = stop;
    await audio.play();
    return stop;
  }

  window.HandVoice = { api, Recorder, ApiError, speak, recordingSupported: supported };
})();
