'use strict';
// Picks the LLM behind the table agent and runs one user request against a scenario.
const S = require('../../public/scenario.js');
const SYSTEM = require('./prompt');
const { DEFS, execute } = require('./tools');
const { createOpenAIAgent } = require('./openai-agent');

function createAgent(config, openai) {
  const a = config.agent || {};
  const provider = a.provider || (a.anthropicKey ? 'anthropic' : openai.configured ? 'openai' : '');
  if (provider === 'anthropic' && a.anthropicKey) {
    const { createAnthropicAgent } = require('./anthropic-agent');
    return createAnthropicAgent({ apiKey: a.anthropicKey, model: a.anthropicModel, effort: a.effort, maxRounds: a.maxRounds, timeoutMs: a.timeoutMs, baseURL: a.anthropicBaseUrl });
  }
  if (provider === 'openai' && openai.configured) return createOpenAIAgent({ openai, model: config.openai.agentModel || 'gpt-6-astra', maxRounds: a.maxRounds || 8 });
  return null;
}

// One request: the user's words + the current scenario (+ a little chat history) → the new scenario and a reply.
async function runAgent(agent, { message, scenario, history }) {
  const { scenario: sc, fixes } = S.normalize(scenario);
  const state = { scenario: sc, changes: [], lastStats: null };
  const userText = `Current table:\n${S.summary(sc)}${fixes.length ? `\n(Repaired on load: ${fixes.join('; ')})` : ''}\n\nUser: ${message}`;
  const started = Date.now();
  const { reply } = await agent.run({ system: SYSTEM, history, userText, tools: DEFS, execute: (name, args) => execute(state, name, args) });
  return { reply, scenario: state.scenario, changes: state.changes, stats: state.lastStats, provider: agent.name, model: agent.model, ms: Date.now() - started };
}

module.exports = { createAgent, runAgent };
