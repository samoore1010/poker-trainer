#!/usr/bin/env node
'use strict';
// Verifies OPENAI_API_KEY and that each configured model exists for that key.
// Run locally (OPENAI_API_KEY=sk-... npm run check:openai) or in Railway's shell (railway run npm run check:openai).
const { loadConfig } = require('../server/config');

(async () => {
  const { openai } = loadConfig();
  if (!openai.apiKey) { console.error('✗ OPENAI_API_KEY is not set.'); process.exit(1); }
  const headers = { Authorization: `Bearer ${openai.apiKey}` };
  if (openai.organization) headers['OpenAI-Organization'] = openai.organization;
  if (openai.project) headers['OpenAI-Project'] = openai.project;
  let failed = false;
  for (const [role, id] of [['transcription', openai.transcribeModel], ['card parsing', openai.textModel], ['text-to-speech', openai.ttsModel]]) {
    try {
      const res = await fetch(`${openai.baseUrl}/models/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(15000) });
      if (res.ok) console.log(`✓ ${role}: ${id}`);
      else { failed = true; const t = await res.text(); console.error(`✗ ${role}: ${id} → ${res.status} ${t.slice(0, 200)}`); }
    } catch (e) { failed = true; console.error(`✗ ${role}: ${id} → ${e.message}`); }
  }
  process.exit(failed ? 1 : 0);
})();
