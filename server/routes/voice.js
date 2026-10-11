'use strict';
// Speech in (transcription) and speech out (text-to-speech).
const { Readable } = require('stream');
const { HttpError, readBody, readJson } = require('../http');

// Biases transcription toward poker vocabulary so "four of hearts" doesn't come back as "for hearts".
const POKER_PROMPT = 'Poker cards being read out, for example: ace of spades, king of hearts, queen of diamonds, jack of clubs, ten of hearts, nine, eight, seven, six, five, four, three, two, deuce. Flop, turn, river. Pocket aces, suited, offsuit.';
const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];

module.exports = function voiceRoutes(router, { config, openai }) {
  // POST raw audio (the MediaRecorder blob) with its Content-Type. ?context=cards adds the poker prompt (default),
  // ?context=none transcribes plain speech for other features; ?lang= sets the language (default en).
  router.post('/api/transcribe', { metered: true }, async (req, res, { send, query }) => {
    const mime = req.headers['content-type'] || '';
    if (!/^(audio|video)\//.test(mime)) throw new HttpError(415, 'bad_audio_type', 'Send the recording as the request body with an audio/* Content-Type.');
    const audio = await readBody(req, config.maxAudioBytes);
    if (audio.length < 1000) throw new HttpError(400, 'audio_empty', 'The recording was empty. Check that the right microphone is selected.');
    const started = Date.now();
    const out = await openai.transcribe(audio, mime, { prompt: query.get('context') === 'none' ? '' : POKER_PROMPT, language: query.get('lang') || 'en' });
    send.json(200, { text: out.text, model: out.model, ms: Date.now() - started, bytes: audio.length });
  });

  // POST {text, voice?} → audio/mpeg stream.
  router.post('/api/speak', { metered: true }, async (req, res) => {
    const { text, voice } = await readJson(req);
    if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'text_required', 'Send {"text": "..."}');
    if (text.length > 1500) throw new HttpError(413, 'too_long', 'Text is over 1500 characters.');
    if (voice !== undefined && !VOICES.includes(voice)) throw new HttpError(400, 'bad_voice', `voice must be one of ${VOICES.join(', ')}`);
    const upstream = await openai.speak(text.trim(), voice ? { voice } : {});
    res.writeHead(200, { 'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': 'no-store' });
    Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
  });
};
