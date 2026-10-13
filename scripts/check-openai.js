#!/usr/bin/env node
'use strict';
// Verifies the API keys and that each configured model exists for them.
// Run locally (OPENAI_API_KEY=sk-... npm run check:openai) or in Railway's shell (railway run npm run check:openai).
const { loadConfig } = require('../server/config');

(async () => {
  const { openai, agent, vision } = loadConfig();
  const visionOnClaude = agent.anthropicKey && vision.provider !== 'openai';
  let failed = false;
  const ok = msg => console.log('✓ ' + msg), bad = msg => { failed = true; console.error('✗ ' + msg); };

  if (!openai.apiKey) console.log('· OPENAI_API_KEY is not set (voice and the OpenAI coach are off).');
  else {
    const headers = { Authorization: `Bearer ${openai.apiKey}` };
    if (openai.organization) headers['OpenAI-Organization'] = openai.organization;
    if (openai.project) headers['OpenAI-Project'] = openai.project;
    const models = [['transcription', openai.transcribeModel], ['card parsing', openai.textModel], ['text-to-speech', openai.ttsModel]];
    if (!agent.anthropicKey || agent.provider === 'openai') models.push(['table agent', openai.agentModel]);
    if (!visionOnClaude) models.push(['camera card reading', vision.openaiModel || openai.agentModel]);
    for (const [role, id] of models) {
      try {
        const res = await fetch(`${openai.baseUrl}/models/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(15000) });
        if (res.ok) ok(`${role}: ${id}`); else bad(`${role}: ${id} → ${res.status} ${(await res.text()).slice(0, 200)}`);
      } catch (e) { bad(`${role}: ${id} → ${e.message}`); }
    }
  }

  if (agent.anthropicKey) {
    const Anthropic = require('@anthropic-ai/sdk').default;
    const client = new Anthropic({ apiKey: agent.anthropicKey, ...(agent.anthropicBaseUrl ? { baseURL: agent.anthropicBaseUrl } : {}) });
    const checks = [];
    if (agent.provider !== 'openai') checks.push(['table agent (Claude)', agent.anthropicModel]);
    if (visionOnClaude) checks.push(['camera card reading (Claude)', vision.anthropicModel]);
    for (const [role, id] of checks) {
      try { const m = await client.models.retrieve(id); ok(`${role}: ${m.id}`); }
      catch (e) {
        if (e instanceof Anthropic.AuthenticationError) { bad('ANTHROPIC_API_KEY was rejected.'); break; }
        else if (e instanceof Anthropic.NotFoundError) bad(`${role}: model ${id} not found.`);
        else bad(`${role}: check failed: ${e.message}`);
      }
    }
  }
  if (!openai.apiKey && !agent.anthropicKey) bad('No API keys set: add OPENAI_API_KEY (voice + coach) and/or ANTHROPIC_API_KEY (coach).');
  process.exit(failed ? 1 : 0);
})();
