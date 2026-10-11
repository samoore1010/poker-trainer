'use strict';
// Agent loop on Claude through the official Anthropic SDK's tool runner.
// Server-side fallbacks are on by default: if the model declines a request, the API retries it on a fallback model.
const Anthropic = require('@anthropic-ai/sdk').default;
const { betaTool } = require('@anthropic-ai/sdk/helpers/beta/json-schema');
const { HttpError } = require('../http');

function createAnthropicAgent({ apiKey, model, effort = 'low', maxRounds = 4, timeoutMs = 60000, baseURL }) {
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2, ...(baseURL ? { baseURL } : {}) });
  return {
    name: 'anthropic', model,
    async run({ system, history, userText, tools, execute, onRound = () => {} }) {
      onRound(0);
      const runnable = tools.map(t => betaTool({
        name: t.name, description: t.description, inputSchema: t.parameters,
        run: async input => { const out = JSON.stringify(execute(t.name, input)); onRound(1); return out; },
      }));
      const messages = history.map(h => ({ role: h.role, content: h.text })).concat([{ role: 'user', content: userText }]);
      let final;
      try {
        final = await client.beta.messages.toolRunner({
          model, max_tokens: 16000, system, messages, tools: runnable, max_iterations: maxRounds,
          output_config: { effort },
          betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        });
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'llm_auth', 'Anthropic rejected the API key. Check ANTHROPIC_API_KEY.');
        if (e instanceof Anthropic.NotFoundError) throw new HttpError(502, 'llm_model', `Anthropic model problem: ${e.message}`);
        if (e instanceof Anthropic.RateLimitError) throw new HttpError(502, 'llm_rate_limited', 'Anthropic rate limit reached. Try again shortly.');
        if (e instanceof Anthropic.BadRequestError) throw new HttpError(502, 'llm_error', `Anthropic rejected the request: ${e.message}`);
        if (e instanceof Anthropic.APIConnectionError) throw new HttpError(504, 'llm_unreachable', 'Could not reach Anthropic.');
        if (e instanceof Anthropic.APIError) throw new HttpError(502, 'llm_error', `Anthropic error ${e.status}: ${e.message}`);
        throw e;
      }
      if (final.stop_reason === 'refusal') return { reply: 'I can\'t help with that request.' };
      const reply = final.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      return { reply: reply || (final.stop_reason === 'tool_use' ? 'I made the changes but ran out of steps before summarizing. Ask me to explain the spot.' : '') };
    },
  };
}

module.exports = { createAnthropicAgent };
