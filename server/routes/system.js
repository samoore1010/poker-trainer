'use strict';
// Health check for Railway and a status endpoint the browser reads to decide which features to show.

module.exports = function systemRoutes(router, { config, openai, agent, vision }) {
  router.get('/health', (req, res, { send }) => send.text(200, 'ok'));

  router.get('/api/status', (req, res, { send }) => send.json(200, {
    ok: true,
    accessCodeRequired: !!config.accessCode,
    features: { transcribe: openai.configured, parseCards: openai.configured, speak: openai.configured, agent: !!agent, vision: !!vision },
    models: openai.configured ? openai.models : null,
    agent: agent ? { provider: agent.name, model: agent.model } : null,
    vision: vision ? { provider: vision.name, model: vision.model, syncModel: vision.syncModel } : null,
    limits: { maxAudioMb: Math.round(config.maxAudioBytes / 1048576), ratePerMin: config.rateLimitPerMin },
  }));
};
