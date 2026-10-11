#!/usr/bin/env node
'use strict';
// Verifies the API keys and that each configured model exists for them.
// Run locally (OPENAI_API_KEY=sk-... npm run check:openai) or in Railway's shell (railway run npm run check:openai).
const { loadConfig } = require('../server/config');

(async () => {
  const { openai, agent } = loadConfig();
  let failed = false;
  const ok = msg => console.log('✓ ' + msg), bad = msg => { failed = true; console.error('✗ ' + msg); };

  if (!openai.apiKey) console.log('· OPENAI_API_KEY is not set (voice and the OpenAI coach are off).');
  else {
    const headers = { Authorization: `Bearer ${openai.apiKey}` };
    if (openai.organization) headers['OpenAI-Organization'] = openai.organization;
    if (openai.project) headers['OpenAI-Project'] = openai.project;
    const models = [['transcription', openai.transcribeModel], ['card parsing', openai.textModel], ['text-to-speech', openai.ttsModel]];
    if (!agent.anthropicKey || agent.provider === 'openai') models.push(['table agent', openai.agentModel]);
    for (const [role, id] of models) {
      try {
        const res = await fetch(`${openai.baseUrl}/models/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(15000) });
        if (res.ok) ok(`${role}: ${id}`); else bad(`${role}: ${id} → ${res.status} ${(await res.text()).slice(0, 200)}`);
      } catch (e) { bad(`${role}: ${id} → ${e.message}`); }
    }
  }

  if (agent.anthropicKey && agent.provider !== 'openai') {
    const Anthropic = require('@anthropic-ai/sdk').default;
    const client = new Anthropic({ apiKey: agent.anthropicKey, ...(agent.anthropicBaseUrl ? { baseURL: agent.anthropicBaseUrl } : {}) });
    try { const m = await client.models.retrieve(agent.anthropicModel); ok(`table agent (Claude): ${m.id}`); }
    catch (e) {
      if (e instanceof Anthropic.AuthenticationError) bad('ANTHROPIC_API_KEY was rejected.');
      else if (e instanceof Anthropic.NotFoundError) bad(`Claude model ${agent.anthropicModel} not found.`);
      else bad(`Claude check failed: ${e.message}`);
    }
  }
  if (!openai.apiKey && !agent.anthropicKey) bad('No API keys set: add OPENAI_API_KEY (voice + coach) and/or ANTHROPIC_API_KEY (coach).');
  process.exit(failed ? 1 : 0);
})();
