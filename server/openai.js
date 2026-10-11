'use strict';
// Thin OpenAI REST client on Node's built-in fetch (no SDK). Every call has a timeout,
// one retry on rate limits and server errors, and errors mapped to HttpError codes the browser understands.
const { HttpError } = require('./http');

const AUDIO_EXT = { 'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'video/mp4': 'mp4', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/flac': 'flac' };
const audioExt = mime => AUDIO_EXT[(mime || '').split(';')[0].trim().toLowerCase()];

function createOpenAI(cfg, { fetchImpl = fetch, log = () => {} } = {}) {
  const configured = !!cfg.apiKey;

  async function call(path, { body, headers = {}, expect = 'json' }) {
    if (!configured) throw new HttpError(503, 'openai_not_configured', 'Voice needs OPENAI_API_KEY set on the server.');
    const auth = { Authorization: `Bearer ${cfg.apiKey}` };
    if (cfg.organization) auth['OpenAI-Organization'] = cfg.organization;
    if (cfg.project) auth['OpenAI-Project'] = cfg.project;
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 600));
      const started = Date.now();
      let res;
      try {
        res = await fetchImpl(cfg.baseUrl + path, { method: 'POST', headers: { ...auth, ...headers }, body, signal: AbortSignal.timeout(cfg.timeoutMs) });
      } catch (e) {
        lastErr = new HttpError(504, 'openai_unreachable', e.name === 'TimeoutError' ? 'OpenAI took too long to answer.' : `Could not reach OpenAI: ${e.message}`);
        continue;
      }
      log({ msg: 'openai', path, status: res.status, ms: Date.now() - started, attempt });
      if (res.ok) return expect === 'stream' ? res : res.json();
      const text = await res.text().catch(() => '');
      let detail = text.slice(0, 300); try { detail = JSON.parse(text).error.message || detail; } catch (e) {}
      if (res.status === 401) throw new HttpError(502, 'openai_auth', 'OpenAI rejected the API key. Check OPENAI_API_KEY in your Railway variables.');
      if (res.status === 404 || (res.status === 400 && /model/i.test(detail))) throw new HttpError(502, 'openai_model', `OpenAI model problem: ${detail}`);
      if (res.status === 429 && /quota|billing/i.test(detail)) throw new HttpError(502, 'openai_quota', 'Your OpenAI account is out of credit or over its quota.');
      lastErr = new HttpError(502, res.status === 429 ? 'openai_rate_limited' : 'openai_error', `OpenAI error (${res.status}): ${detail}`);
      if (res.status !== 429 && res.status < 500) throw lastErr;
    }
    throw lastErr;
  }

  return {
    configured,
    models: { transcribe: cfg.transcribeModel, text: cfg.textModel, tts: cfg.ttsModel },

    // Speech → text. audio is a Buffer, mime the recorder's Content-Type.
    async transcribe(audio, mime, { prompt, language = 'en' } = {}) {
      const ext = audioExt(mime);
      if (!ext) throw new HttpError(415, 'bad_audio_type', `Unsupported audio type "${mime}".`);
      const form = new FormData();
      form.append('file', new Blob([audio], { type: mime.split(';')[0] }), `speech.${ext}`);
      form.append('model', cfg.transcribeModel);
      form.append('response_format', 'json');
      if (language) form.append('language', language);
      if (prompt) form.append('prompt', prompt);
      const out = await call('/audio/transcriptions', { body: form });
      return { text: (out.text || '').trim(), model: cfg.transcribeModel };
    },

    // Text → structured JSON that must match the given JSON schema (Structured Outputs).
    async json({ system, user, schema, name = 'result', model = cfg.textModel }) {
      const out = await call('/chat/completions', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
        }),
      });
      const msg = out.choices && out.choices[0] && out.choices[0].message;
      if (!msg || msg.refusal || !msg.content) throw new HttpError(502, 'openai_empty', 'OpenAI returned no answer.');
      try { return JSON.parse(msg.content); } catch (e) { throw new HttpError(502, 'openai_bad_json', 'OpenAI returned malformed JSON.'); }
    },

    // Raw Responses API call (used by the agent's tool loop).
    responses(body) { return call('/responses', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); },

    // Text → speech. Returns the fetch Response so the route can stream audio straight through.
    async speak(text, { voice = cfg.ttsVoice, instructions = cfg.ttsInstructions, format = 'mp3' } = {}) {
      const body = { model: cfg.ttsModel, input: text, voice, response_format: format };
      if (instructions && !/^tts-1/.test(cfg.ttsModel)) body.instructions = instructions;
      return call('/audio/speech', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), expect: 'stream' });
    },
  };
}

module.exports = { createOpenAI, audioExt };
