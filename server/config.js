'use strict';
// All runtime settings come from environment variables (set them in Railway → Variables).
// Only OPENAI_API_KEY is needed for voice; everything else has a working default.

const str = (name, def = '') => (process.env[name] ?? '').trim() || def;
const int = (name, def) => { const v = parseInt(process.env[name], 10); return Number.isFinite(v) ? v : def; };

function loadConfig() {
  return {
    port: int('PORT', 3000),
    host: str('HOST', '0.0.0.0'),
    env: str('NODE_ENV', 'development'),
    // Optional shared code visitors must enter before the app spends OpenAI credits. Empty = open.
    accessCode: str('ACCESS_CODE'),
    // Requests per minute per visitor IP, across all /api routes that call OpenAI.
    rateLimitPerMin: int('RATE_LIMIT_PER_MIN', 30),
    maxAudioBytes: int('MAX_AUDIO_MB', 15) * 1024 * 1024,
    openai: {
      apiKey: str('OPENAI_API_KEY'),
      baseUrl: str('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/+$/, ''),
      organization: str('OPENAI_ORG_ID'),
      project: str('OPENAI_PROJECT_ID'),
      timeoutMs: int('OPENAI_TIMEOUT_MS', 30000),
      transcribeModel: str('OPENAI_TRANSCRIBE_MODEL', 'gpt-4o-mini-transcribe'),
      textModel: str('OPENAI_TEXT_MODEL', 'gpt-5.4-nano'),
      ttsModel: str('OPENAI_TTS_MODEL', 'gpt-4o-mini-tts'),
      ttsVoice: str('OPENAI_TTS_VOICE', 'alloy'),
      ttsInstructions: str('OPENAI_TTS_INSTRUCTIONS', 'Speak like a calm, friendly poker coach. Clear and unhurried.'),
    },
  };
}

module.exports = { loadConfig };
