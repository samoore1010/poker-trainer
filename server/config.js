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
      agentModel: str('OPENAI_AGENT_MODEL', 'gpt-6-astra'),
      // Reasoning effort for the coach on OpenAI reasoning models (none|low|medium|high); 'off' sends no setting.
      agentReasoning: str('OPENAI_AGENT_REASONING', 'low'),
    },
    // Camera card reading (the phone asks when it sees the table change). VISION_PROVIDER picks anthropic|openai;
    // unset = Claude when ANTHROPIC_API_KEY is set, else OpenAI.
    vision: {
      provider: str('VISION_PROVIDER').toLowerCase(),
      anthropicModel: str('VISION_MODEL', 'claude-haiku-5-5'),
      openaiModel: str('OPENAI_VISION_MODEL'),
      timeoutMs: int('VISION_TIMEOUT_MS', 20000),
    },
    // The table agent runs on OpenAI or Claude. AGENT_PROVIDER picks one; unset = Claude when ANTHROPIC_API_KEY is set, else OpenAI.
    agent: {
      provider: str('AGENT_PROVIDER').toLowerCase(),
      maxRounds: int('AGENT_MAX_ROUNDS', 4),
      anthropicKey: str('ANTHROPIC_API_KEY'),
      anthropicModel: str('ANTHROPIC_MODEL', 'claude-opus-5-5'),
      anthropicBaseUrl: str('ANTHROPIC_BASE_URL'),
      effort: str('AGENT_EFFORT', 'low'),
      timeoutMs: int('AGENT_TIMEOUT_MS', 90000),
    },
  };
}

module.exports = { loadConfig };
